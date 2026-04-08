const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function parseMinutes(value) {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

function formatMinutes(value) {
  const h = Math.floor(value / 60)
  const m = value % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function getDayDates(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`)
  return DAY_KEYS.map((key, index) => {
    const d = new Date(start)
    d.setDate(d.getDate() + index)
    return { key, date: d.toISOString().slice(0, 10), dow: index + 1 }
  })
}

function euclideanMinutes(fromLat, fromLng, toLat, toLng) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => typeof v !== 'number')) return 20
  const dx = fromLat - toLat
  const dy = fromLng - toLng
  return Math.max(5, Math.round(Math.sqrt(dx * dx + dy * dy) * 900))
}

function euclideanKm(fromLat, fromLng, toLat, toLng) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => typeof v !== 'number')) return 5
  const dx = fromLat - toLat
  const dy = fromLng - toLng
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 111 * 10) / 10
}

async function buildOSRMMatrix(locations) {
  if (!locations.length) return null
  const coords = locations.map((l) => `${l.lng},${l.lat}`).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 'Ok') return null
    const durations = data.durations.map((row) =>
      row.map((v) => (v === null ? null : Math.max(1, Math.round(v / 60))))
    )
    const distances = data.distances
      ? data.distances.map((row) => row.map((v) => (v === null ? null : Math.round(v / 100) / 10)))
      : null
    return { durations, distances }
  } catch {
    return null
  }
}

function createTravelFn(matrix, locations) {
  const idx = new Map(locations.map((l, i) => [`${l.lat},${l.lng}`, i]))
  return function travelFn(fromLat, fromLng, toLat, toLng) {
    const fi = idx.get(`${fromLat},${fromLng}`)
    const ti = idx.get(`${toLat},${toLng}`)
    let minutes, km
    if (matrix && fi !== undefined && ti !== undefined) {
      minutes = matrix.durations[fi]?.[ti] ?? euclideanMinutes(fromLat, fromLng, toLat, toLng)
      km = matrix.distances
        ? (matrix.distances[fi]?.[ti] ?? euclideanKm(fromLat, fromLng, toLat, toLng))
        : euclideanKm(fromLat, fromLng, toLat, toLng)
    } else {
      minutes = euclideanMinutes(fromLat, fromLng, toLat, toLng)
      km = euclideanKm(fromLat, fromLng, toLat, toLng)
    }
    return { minutes, km }
  }
}

function normalizeWindows(windows) {
  return (windows ?? [])
    .filter((w) => w && w.start_time && w.end_time)
    .map((w) => ({ start: parseMinutes(w.start_time), end: parseMinutes(w.end_time) }))
    .filter((w) => w.start !== null && w.end !== null && w.end > w.start)
    .sort((a, b) => a.start - b.start)
}

function isInsideBlocked(timeStart, timeEnd, blockedWindows) {
  return blockedWindows.some((b) => !(timeEnd <= b.start || timeStart >= b.end))
}

/**
 * Pré-assigne chaque patient à des jours spécifiques de la semaine.
 *
 * Règles :
 *  - Respecte sessions_per_week
 *  - Minimum 2 jours d'écart entre deux passages (règle des 48h)
 *  - Respecte les indisponibilités du patient et ses absences ponctuelles
 *  - Patterns naturels :
 *      1x/sem → 1 jour quelconque
 *      2x/sem → Lun+Mer, Mar+Jeu, Mer+Ven… (écart ≥ 2)
 *      3x/sem → Lun+Mer+Ven de préférence
 *
 * Retourne un Map : patientId → [dayKey, ...]
 */
function preAssignDays(patients, enabledDays, absentSet) {
  const assignments = new Map()

  for (const patient of patients) {
    if (!patient.active) { assignments.set(patient.id, []); continue }

    const n = Math.max(0, Number(patient.sessions_per_week ?? 1))
    if (n === 0) { assignments.set(patient.id, []); continue }

    // Jours disponibles pour ce patient cette semaine
    const availableDays = enabledDays.filter((day) => {
      if (absentSet.has(`${patient.id}|${day.date}`)) return false
      const dayAvail = (patient.availability ?? {})[day.key] ?? {}
      if (dayAvail.unavailable === true) return false
      return true
    })

    if (!availableDays.length) { assignments.set(patient.id, []); continue }

    // Sélection gloutonne : n jours avec écart ≥ 2 entre chaque
    function pickWithGap(remaining, minDow, chosen) {
      if (remaining === 0) return chosen
      for (const day of availableDays) {
        if (day.dow >= minDow) {
          const result = pickWithGap(remaining - 1, day.dow + 2, [...chosen, day.key])
          if (result) return result
        }
      }
      return null
    }

    let picked = pickWithGap(n, 1, [])

    // Fallback si impossible de respecter l'écart (ex: seulement 2 jours activés
    // et patient 3x/sem) → on prend ce qu'on peut avec écart maximal possible
    if (!picked) {
      picked = pickWithGap(Math.min(n, availableDays.length), 1, [])
        ?? availableDays.slice(0, n).map((d) => d.key)
    }

    assignments.set(patient.id, picked)
  }

  return assignments
}

/**
 * @param {object} params
 * @param {string} params.weekStart        YYYY-MM-DD (lundi)
 * @param {object} params.therapist
 * @param {object} params.weeklyConfig
 * @param {Array}  params.patients
 * @param {number} params.travelBuffer
 * @param {number} params.sessionBuffer
 * @param {Set}    params.absentSet
 */
export async function generateSchedule({
  weekStart,
  therapist,
  weeklyConfig,
  patients,
  travelBuffer = 10,
  sessionBuffer = 5,
  absentSet = new Set(),
}) {
  const days = getDayDates(weekStart)
  const enabledDays = days.filter((d) => weeklyConfig[d.key]?.enabled)

  // ── Matrice OSRM ──────────────────────────────────────────────────────────
  const allLocations = []
  const addLoc = (lat, lng) => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      if (!allLocations.find((l) => l.lat === lat && l.lng === lng))
        allLocations.push({ lat, lng })
    }
  }
  days.forEach((day) => {
    const cfg = weeklyConfig[day.key]
    if (!cfg?.enabled) return
    addLoc(cfg.start_lat ?? therapist?.default_start_lat, cfg.start_lng ?? therapist?.default_start_lng)
    addLoc(cfg.end_lat ?? therapist?.default_end_lat, cfg.end_lng ?? therapist?.default_end_lng)
  })
  patients.forEach((p) => addLoc(p.lat, p.lng))

  let matrix = null
  if (allLocations.length > 1) {
    try { matrix = await buildOSRMMatrix(allLocations) } catch { matrix = null }
  }
  const travel = createTravelFn(matrix, allLocations)
  const routingSource = matrix ? 'osrm' : 'euclidean'

  // ── Pré-assignation des patients aux jours (règle 48h) ────────────────────
  const dayAssignments = preAssignDays(patients, enabledDays, absentSet)

  // Index inverse : dayKey → [patients assignés ce jour]
  const patientsByDay = new Map(days.map((d) => [d.key, []]))
  for (const patient of patients) {
    const assignedDays = dayAssignments.get(patient.id) ?? []
    for (const dayKey of assignedDays) {
      patientsByDay.get(dayKey)?.push(patient)
    }
  }

  // ── Génération jour par jour ──────────────────────────────────────────────
  const result = []

  for (const day of days) {
    const dayConfig = weeklyConfig[day.key]
    if (!dayConfig?.enabled) {
      result.push({
        day: day.key, dow: day.dow, date: day.date,
        start_address: null, end_address: null, visits: [],
        stats: { total_visits: 0, total_travel_min: 0, total_session_min: 0, total_km: 0 },
      })
      continue
    }

    const dayStart = parseMinutes(dayConfig.work_start)
    const dayEnd   = parseMinutes(dayConfig.work_end)
    const therapistBlocked = normalizeWindows(dayConfig.blocked_windows)

    let currentTime = dayStart
    let currentLat  = dayConfig.start_lat ?? therapist?.default_start_lat
    let currentLng  = dayConfig.start_lng ?? therapist?.default_start_lng
    const visits    = []
    const maxVisits = Number(dayConfig.max_visits ?? 20)

    // Patients assignés à ce jour, fixes en premier
    const todayPatients = (patientsByDay.get(day.key) ?? []).sort((a, b) => {
      if (a.is_fixed && !b.is_fixed) return -1
      if (!a.is_fixed && b.is_fixed) return 1
      return 0
    })

    // Ensemble des patients déjà planifiés ce jour (anti-doublon)
    const visitedToday = new Set()

    for (let i = 0; i < maxVisits && visitedToday.size < todayPatients.length; i++) {
      const candidates = todayPatients.filter((p) => {
        if (visitedToday.has(p.id)) return false

        const { minutes: travelMin } = travel(currentLat, currentLng, p.lat, p.lng)
        const duration   = Number(p.session_duration_min ?? 30)
        const startVisit = currentTime + travelMin + travelBuffer
        const endVisit   = startVisit + duration

        if (endVisit > dayEnd) return false
        if (isInsideBlocked(startVisit, endVisit, therapistBlocked)) return false

        const patientBlocked = normalizeWindows((p.availability?.[day.key] ?? {}).blocked_windows)
        if (isInsideBlocked(startVisit, endVisit, patientBlocked)) return false

        return true
      })

      if (!candidates.length) break

      // Fixes en tête, sinon plus proche
      const scored = candidates.map((p) => {
        const { minutes } = travel(currentLat, currentLng, p.lat, p.lng)
        return { patient: p, score: p.is_fixed ? -Infinity : minutes }
      })
      scored.sort((a, b) => a.score - b.score)
      const chosen = scored[0].patient

      const { minutes: travelMin, km: travelKm } = travel(currentLat, currentLng, chosen.lat, chosen.lng)
      const duration   = Number(chosen.session_duration_min ?? 30)
      const visitStart = currentTime + travelMin + travelBuffer
      const visitEnd   = visitStart + duration

      visits.push({
        patient_id:             chosen.id,
        patient_name:           chosen.full_name,
        address:                chosen.address,
        lat:                    chosen.lat,
        lng:                    chosen.lng,
        start_time:             formatMinutes(visitStart),
        end_time:               formatMinutes(visitEnd),
        session_duration_min:   duration,
        estimated_travel_min:   travelMin + travelBuffer,
        estimated_km:           travelKm,
        is_fixed:               chosen.is_fixed ?? false,
        done:                   false,
      })

      visitedToday.add(chosen.id)
      currentTime = visitEnd + sessionBuffer
      currentLat  = chosen.lat
      currentLng  = chosen.lng
    }

    // Retour
    const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
    const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
    const { minutes: returnMin, km: returnKm } = travel(currentLat, currentLng, endLat, endLng)

    result.push({
      day:   day.key,
      dow:   day.dow,
      date:  day.date,
      start_address: dayConfig.start_address || therapist?.default_start_address || null,
      end_address:   dayConfig.end_address   || therapist?.default_end_address   || null,
      estimated_return_travel_min: returnMin,
      estimated_return_km:         returnKm,
      visits,
      stats: {
        total_visits:     visits.length,
        total_travel_min: Math.round(visits.reduce((s, v) => s + v.estimated_travel_min, 0) + returnMin),
        total_session_min:Math.round(visits.reduce((s, v) => s + v.session_duration_min, 0)),
        total_km:         Math.round((visits.reduce((s, v) => s + (v.estimated_km ?? 0), 0) + returnKm) * 10) / 10,
      },
    })
  }

  const weekStats = result.reduce(
    (acc, d) => ({
      total_visits:     acc.total_visits     + d.stats.total_visits,
      total_travel_min: acc.total_travel_min + d.stats.total_travel_min,
      total_session_min:acc.total_session_min + d.stats.total_session_min,
      total_km:         Math.round((acc.total_km + d.stats.total_km) * 10) / 10,
    }),
    { total_visits: 0, total_travel_min: 0, total_session_min: 0, total_km: 0 }
  )

  return {
    week_start:     weekStart,
    generated_at:   new Date().toISOString(),
    routing_source: routingSource,
    week_stats:     weekStats,
    days:           result,
  }
}
