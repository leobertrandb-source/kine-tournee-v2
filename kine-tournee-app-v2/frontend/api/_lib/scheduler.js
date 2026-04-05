const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

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
    return {
      key,
      date: d.toISOString().slice(0, 10),
      dow: index + 1,
    }
  })
}

// ── Distance euclidienne de secours ────────────────────────────────────────────
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

// ── Matrice OSRM ────────────────────────────────────────────────────────────────
/**
 * Calcule la matrice de durées (minutes) et distances (km) via l'API publique OSRM.
 * Retourne null si OSRM est inaccessible.
 * @param {Array<{lat: number, lng: number}>} locations
 * @returns {Promise<{durations: number[][], distances: number[][]} | null>}
 */
async function buildOSRMMatrix(locations) {
  if (!locations.length) return null
  // Déduplique les coordonnates
  const coords = locations.map((l) => `${l.lng},${l.lat}`).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 'Ok') return null
    // durations en secondes -> minutes, distances en mètres -> km
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

/**
 * Crée une fonction de trajet à partir de la matrice OSRM (ou fallback Euclidien).
 */
function createTravelFn(matrix, locations) {
  // Crée un index positionnel par clé "lat,lng"
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
    .map((w) => ({
      start: parseMinutes(w.start_time),
      end: parseMinutes(w.end_time),
    }))
    .filter((w) => w.start !== null && w.end !== null && w.end > w.start)
    .sort((a, b) => a.start - b.start)
}

function isInsideBlocked(timeStart, timeEnd, blockedWindows) {
  return blockedWindows.some((b) => !(timeEnd <= b.start || timeStart >= b.end))
}

function isInsideAvailable(timeStart, timeEnd, availableWindows) {
  if (!availableWindows.length) return true
  return availableWindows.some((w) => timeStart >= w.start && timeEnd <= w.end)
}

/**
 * @param {object} params
 * @param {string} params.weekStart        YYYY-MM-DD (lundi)
 * @param {object} params.therapist
 * @param {object} params.weeklyConfig
 * @param {Array}  params.patients
 * @param {number} params.travelBuffer
 * @param {number} params.sessionBuffer
 * @param {Set}    params.absentSet        Set de clés "${patientId}|${date}"
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

  // ── Construire la matrice OSRM ──────────────────────────────────────────────
  const allLocations = []
  const addLoc = (lat, lng) => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      if (!allLocations.find((l) => l.lat === lat && l.lng === lng))
        allLocations.push({ lat, lng })
    }
  }

  // Positions thérapeute
  days.forEach((day) => {
    const cfg = weeklyConfig[day.key]
    if (!cfg?.enabled) return
    addLoc(cfg.start_lat ?? therapist?.default_start_lat, cfg.start_lng ?? therapist?.default_start_lng)
    addLoc(cfg.end_lat ?? therapist?.default_end_lat, cfg.end_lng ?? therapist?.default_end_lng)
  })
  // Positions patients
  patients.forEach((p) => addLoc(p.lat, p.lng))

  let matrix = null
  if (allLocations.length > 1) {
    try {
      matrix = await buildOSRMMatrix(allLocations)
    } catch {
      matrix = null
    }
  }
  const travel = createTravelFn(matrix, allLocations)
  const routingSource = matrix ? 'osrm' : 'euclidean'

  // ── Génération jour par jour ────────────────────────────────────────────────
  const remainingVisits = new Map(
    patients.map((p) => [p.id, Math.max(0, Number(p.sessions_per_week ?? 0))])
  )

  const result = []

  for (const day of days) {
    const dayConfig = weeklyConfig[day.key]
    if (!dayConfig?.enabled) {
      result.push({
        day: day.key,
        dow: day.dow,
        date: day.date,
        start_address: null,
        end_address: null,
        visits: [],
        stats: { total_visits: 0, total_travel_min: 0, total_session_min: 0, total_km: 0 },
      })
      continue
    }

    const dayStart = parseMinutes(dayConfig.work_start)
    const dayEnd = parseMinutes(dayConfig.work_end)
    const therapistBlocked = normalizeWindows(dayConfig.blocked_windows)

    let currentTime = dayStart
    let currentLat = dayConfig.start_lat ?? therapist?.default_start_lat
    let currentLng = dayConfig.start_lng ?? therapist?.default_start_lng
    const visits = []
    const maxVisits = Number(dayConfig.max_visits ?? 20)

    // Trier : patients fixes (is_fixed) en priorité
    const sortedPatients = [...patients].sort((a, b) => {
      if (a.is_fixed && !b.is_fixed) return -1
      if (!a.is_fixed && b.is_fixed) return 1
      return 0
    })

    for (let i = 0; i < maxVisits; i += 1) {
      const candidates = sortedPatients.filter((p) => {
        const remaining = remainingVisits.get(p.id) ?? 0
        if (!p.active || remaining <= 0) return false

        // Absence ponctuelle sur ce jour exact
        if (absentSet.has(`${p.id}|${day.date}`)) return false

        const patientDay = (p.availability ?? {})[day.key] ?? {}
        if (patientDay.unavailable === true) return false

        const { minutes: travelMin } = travel(currentLat, currentLng, p.lat, p.lng)
        const travelWithBuffer = travelMin + travelBuffer
        const duration = Number(p.session_duration_min ?? 30)
        const startVisit = currentTime + travelWithBuffer
        const endVisit = startVisit + duration

        if (endVisit > dayEnd) return false
        if (isInsideBlocked(startVisit, endVisit, therapistBlocked)) return false

        const patientAvailable = normalizeWindows(patientDay.available_windows)
        const patientBlocked = normalizeWindows(patientDay.blocked_windows)

        if (!isInsideAvailable(startVisit, endVisit, patientAvailable)) return false
        if (isInsideBlocked(startVisit, endVisit, patientBlocked)) return false

        return true
      })

      if (!candidates.length) break

      // Choisir le patient le plus proche (parmi les fixes en priorité déjà triés)
      const scored = candidates.map((p) => {
        const { minutes } = travel(currentLat, currentLng, p.lat, p.lng)
        return { patient: p, score: p.is_fixed ? -Infinity : minutes }
      })
      // Si au moins un fixe, on prend le premier (déjà trié) sans optimiser la distance
      // Sinon on prend le plus proche
      scored.sort((a, b) => a.score - b.score)
      const chosen = scored[0].patient

      const { minutes: travelMin, km: travelKm } = travel(currentLat, currentLng, chosen.lat, chosen.lng)
      const travelWithBuffer = travelMin + travelBuffer
      const duration = Number(chosen.session_duration_min ?? 30)
      const visitStart = currentTime + travelWithBuffer
      const visitEnd = visitStart + duration

      visits.push({
        patient_id: chosen.id,
        patient_name: chosen.full_name,
        address: chosen.address,
        lat: chosen.lat,
        lng: chosen.lng,
        start_time: formatMinutes(visitStart),
        end_time: formatMinutes(visitEnd),
        session_duration_min: duration,
        estimated_travel_min: travelWithBuffer,
        estimated_km: travelKm,
        is_fixed: chosen.is_fixed ?? false,
        done: false,
      })

      remainingVisits.set(chosen.id, (remainingVisits.get(chosen.id) ?? 1) - 1)
      currentTime = visitEnd + sessionBuffer
      currentLat = chosen.lat
      currentLng = chosen.lng
    }

    // Retour au domicile
    const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
    const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
    const { minutes: returnMin, km: returnKm } = travel(currentLat, currentLng, endLat, endLng)

    const totalTravelMin = visits.reduce((s, v) => s + v.estimated_travel_min, 0) + returnMin
    const totalSessionMin = visits.reduce((s, v) => s + v.session_duration_min, 0)
    const totalKm = visits.reduce((s, v) => s + (v.estimated_km ?? 0), 0) + returnKm

    result.push({
      day: day.key,
      dow: day.dow,
      date: day.date,
      start_address: dayConfig.start_address || therapist?.default_start_address || null,
      end_address: dayConfig.end_address || therapist?.default_end_address || null,
      estimated_return_travel_min: returnMin,
      estimated_return_km: returnKm,
      visits,
      stats: {
        total_visits: visits.length,
        total_travel_min: Math.round(totalTravelMin),
        total_session_min: Math.round(totalSessionMin),
        total_km: Math.round(totalKm * 10) / 10,
      },
    })
  }

  // Stats globales de la semaine
  const weekStats = result.reduce(
    (acc, d) => ({
      total_visits: acc.total_visits + d.stats.total_visits,
      total_travel_min: acc.total_travel_min + d.stats.total_travel_min,
      total_session_min: acc.total_session_min + d.stats.total_session_min,
      total_km: Math.round((acc.total_km + d.stats.total_km) * 10) / 10,
    }),
    { total_visits: 0, total_travel_min: 0, total_session_min: 0, total_km: 0 }
  )

  return {
    week_start: weekStart,
    generated_at: new Date().toISOString(),
    routing_source: routingSource,
    week_stats: weekStats,
    days: result,
  }
}
