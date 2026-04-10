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
 * Minutes disponibles dans la journée pour un patient, après soustraction de
 * toutes les plages bloquées (thérapeute + patient). Sert à trier les patients
 * les plus contraints en tête de tournée.
 */
function availableMinutesInDay(dayStart, dayEnd, therapistBlocked, patientBlockedWindows) {
  const patientBlocked = normalizeWindows(patientBlockedWindows)
  const allBlocked = [...therapistBlocked, ...patientBlocked]
  let available = dayEnd - dayStart
  for (const b of allBlocked) {
    const s = Math.max(b.start, dayStart)
    const e = Math.min(b.end, dayEnd)
    if (e > s) available -= (e - s)
  }
  return Math.max(0, available)
}

/**
 * Évalue un ordre de visite : retourne { totalTravel, schedule } si faisable,
 * null sinon. Saute automatiquement les plages bloquées thérapeute.
 */
function computeRouteOrder(orderedPatients, { startLat, startLng, dayStart, dayEnd, dayKey, dayDate, therapistBlocked, partialAbsenceMap, travel, travelBuffer, sessionBuffer }) {
  let t = dayStart
  let lat = startLat
  let lng = startLng
  let totalTravel = 0
  const schedule = []

  for (const p of orderedPatients) {
    const { minutes: travelMin, km: travelKm } = travel(lat, lng, p.lat, p.lng)
    const duration = Number(p.session_duration_min ?? 30)
    let visitStart = t + travelMin + travelBuffer
    let visitEnd = visitStart + duration

    // Sauter les plages bloquées thérapeute (plusieurs passages possibles)
    for (let iter = 0; iter < therapistBlocked.length + 1; iter++) {
      const overlap = therapistBlocked.find((b) => visitStart < b.end && visitEnd > b.start)
      if (!overlap) break
      visitStart = overlap.end
      visitEnd = visitStart + duration
    }

    if (visitEnd > dayEnd) return null

    const patientBlocked = normalizeWindows((p.availability?.[dayKey] ?? {}).blocked_windows)
    if (isInsideBlocked(visitStart, visitEnd, patientBlocked)) return null

    const partialAbsence = partialAbsenceMap.get(`${p.id}|${dayDate}`) ?? []
    if (partialAbsence.length && isInsideBlocked(visitStart, visitEnd, partialAbsence)) return null

    totalTravel += travelMin
    schedule.push({ patient: p, visitStart, visitEnd, travelMin, travelKm })
    lat = p.lat
    lng = p.lng
    t = visitEnd + sessionBuffer
  }

  return { totalTravel, schedule }
}

/**
 * Améliore l'ordre des visites par l'algorithme 2-opt :
 * pour chaque paire d'arêtes, inverse le segment si cela réduit le trajet
 * total et reste faisable. Les patients is_fixed ne sont pas déplacés.
 */
function twoOptImprove(patients, ctx) {
  if (patients.length < 3) return patients
  const fixedCount = patients.filter((p) => p.is_fixed).length

  let best = [...patients]
  let bestResult = computeRouteOrder(best, ctx)
  if (!bestResult) return patients

  let improved = true
  while (improved) {
    improved = false
    outer: for (let i = fixedCount; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        const r = computeRouteOrder(candidate, ctx)
        if (r && r.totalTravel < bestResult.totalTravel) {
          best = candidate
          bestResult = r
          improved = true
          break outer
        }
      }
    }
  }

  return best
}

const TOURNEE_A = ['monday', 'wednesday']
const TOURNEE_B = ['tuesday', 'thursday']

/**
 * Clustering k-means géographique à 2 zones.
 * Initialise les centroides sur les adresses de départ des tournées A et B,
 * puis itère jusqu'à convergence pour obtenir des zones cohérentes sans
 * traversée inutile de secteurs.
 *
 * @param   patients  - patients avec lat/lng
 * @param   centerA   - {lat, lng} départ tournée A (lundi)
 * @param   centerB   - {lat, lng} départ tournée B (mardi)
 * @returns Map<patientId, 0|1>  — 0 = zone A, 1 = zone B
 */
function kmeansZones(patients, centerA, centerB, maxIter = 10) {
  const pts = patients.filter((p) => p.lat && p.lng)
  if (!pts.length) return new Map()

  let centers = [
    { lat: centerA.lat, lng: centerA.lng },
    { lat: centerB.lat, lng: centerB.lng },
  ]
  let assignments = new Map()

  for (let iter = 0; iter < maxIter; iter++) {
    const clusters = [[], []]
    const next = new Map()

    for (const p of pts) {
      const dA = euclideanKm(p.lat, p.lng, centers[0].lat, centers[0].lng)
      const dB = euclideanKm(p.lat, p.lng, centers[1].lat, centers[1].lng)
      const zone = dA <= dB ? 0 : 1
      next.set(p.id, zone)
      clusters[zone].push(p)
    }

    // Convergence ?
    let changed = false
    for (const [id, zone] of next) {
      if (assignments.get(id) !== zone) { changed = true; break }
    }
    assignments = next
    if (!changed) break

    // Recalculer les centroides (conserver l'ancien si cluster vide)
    for (let i = 0; i < 2; i++) {
      if (clusters[i].length > 0) {
        centers[i] = {
          lat: clusters[i].reduce((s, p) => s + p.lat, 0) / clusters[i].length,
          lng: clusters[i].reduce((s, p) => s + p.lng, 0) / clusters[i].length,
        }
      }
    }
  }

  return assignments
}

/**
 * Pré-assigne chaque patient à des jours spécifiques de la semaine.
 *
 * Règles :
 *  - Respecte sessions_per_week avec écart ≥ 2 jours
 *  - Tournée explicite (patient.tournee = 'A' ou 'B') : préfère Lun+Mer ou Mar+Jeu
 *  - Tournée automatique (2x/sem) : assignation géographique (proximité départ tournée A vs B)
 *    → fallback round-robin si coordonnées manquantes ou identiques
 *  - 3x/sem : Lun+Mer+Ven de préférence
 *
 * @param startLocByDay - { monday:{lat,lng}, tuesday:{lat,lng}, … }
 */
function preAssignDays(patients, enabledDays, absentSet, startLocByDay = {}) {
  const assignments = new Map()
  let autoTourneeCounter = 0

  const aLoc = startLocByDay['monday']
  const bLoc = startLocByDay['tuesday']
  const geoAvailable = !!(
    aLoc?.lat && aLoc?.lng && bLoc?.lat && bLoc?.lng &&
    (aLoc.lat !== bLoc.lat || aLoc.lng !== bLoc.lng)
  )

  // Pré-calculer les zones k-means pour les patients auto 2x/sem avec coordonnées
  const autoPatients2x = patients.filter(
    (p) => p.active && !p.tournee && Number(p.sessions_per_week ?? 1) === 2 && p.lat && p.lng
  )
  const zoneMap = geoAvailable ? kmeansZones(autoPatients2x, aLoc, bLoc) : new Map()

  for (const patient of patients) {
    if (!patient.active) { assignments.set(patient.id, []); continue }

    const n = Math.max(0, Number(patient.sessions_per_week ?? 1))
    if (n === 0) { assignments.set(patient.id, []); continue }

    const availableDays = enabledDays.filter((day) => {
      if (absentSet.has(`${patient.id}|${day.date}`)) return false
      const dayAvail = (patient.availability ?? {})[day.key] ?? {}
      return dayAvail.unavailable !== true
    })

    if (!availableDays.length) { assignments.set(patient.id, []); continue }

    let preferred = null
    if (patient.tournee === 'A') {
      preferred = TOURNEE_A
    } else if (patient.tournee === 'B') {
      preferred = TOURNEE_B
    } else if (n === 2) {
      if (zoneMap.has(patient.id)) {
        // Zone k-means : assignation géographique convergée
        preferred = zoneMap.get(patient.id) === 0 ? TOURNEE_A : TOURNEE_B
      } else {
        // Fallback (pas de coords) : round-robin équilibré
        preferred = autoTourneeCounter % 2 === 0 ? TOURNEE_A : TOURNEE_B
        autoTourneeCounter++
      }
    }

    const sortedDays = preferred
      ? [...availableDays].sort((a, b) => {
          const aP = preferred.includes(a.key) ? 0 : 1
          const bP = preferred.includes(b.key) ? 0 : 1
          return aP - bP || a.dow - b.dow
        })
      : availableDays

    function pickWithGap(remaining, minDow, chosen) {
      if (remaining === 0) return chosen
      for (const day of sortedDays) {
        if (day.dow >= minDow) {
          const result = pickWithGap(remaining - 1, day.dow + 2, [...chosen, day.key])
          if (result) return result
        }
      }
      return null
    }

    let picked = pickWithGap(n, 1, [])
    if (!picked) {
      picked = pickWithGap(Math.min(n, sortedDays.length), 1, [])
        ?? sortedDays.slice(0, n).map((d) => d.key)
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
 * @param {Array}  params.absences         [{patient_id, absence_date, start_time?, end_time?}]
 */
export async function generateSchedule({
  weekStart,
  therapist,
  weeklyConfig,
  patients,
  travelBuffer = 10,
  sessionBuffer = 5,
  absences = [],
}) {
  const days = getDayDates(weekStart)
  const enabledDays = days.filter((d) => weeklyConfig[d.key]?.enabled)

  // ── Traitement des absences ───────────────────────────────────────────────
  // fullDayAbsenceSet : "patientId|date" → exclure entièrement le patient ce jour
  // partialAbsenceMap : "patientId|date" → [{start, end}] → fenêtre bloquée uniquement
  const fullDayAbsenceSet = new Set()
  const partialAbsenceMap = new Map()
  for (const a of absences) {
    const key = `${a.patient_id}|${a.absence_date}`
    if (a.start_time && a.end_time) {
      if (!partialAbsenceMap.has(key)) partialAbsenceMap.set(key, [])
      partialAbsenceMap.get(key).push({
        start: parseMinutes(a.start_time),
        end:   parseMinutes(a.end_time),
      })
    } else {
      fullDayAbsenceSet.add(key)
    }
  }

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

  // ── Coordonnées de départ par jour (pour l'assignation géographique) ────────
  const startLocByDay = {}
  days.forEach((day) => {
    const cfg = weeklyConfig[day.key]
    if (!cfg?.enabled) return
    const lat = cfg.start_lat ?? therapist?.default_start_lat
    const lng = cfg.start_lng ?? therapist?.default_start_lng
    if (lat && lng) startLocByDay[day.key] = { lat, lng }
  })

  // ── Pré-assignation des patients aux jours (règle 48h + géographie) ───────
  const dayAssignments = preAssignDays(patients, enabledDays, fullDayAbsenceSet, startLocByDay)

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

    const dayStartLat = dayConfig.start_lat ?? therapist?.default_start_lat
    const dayStartLng = dayConfig.start_lng ?? therapist?.default_start_lng
    let currentTime = dayStart
    let currentLat  = dayStartLat
    let currentLng  = dayStartLng
    const visits    = []
    const maxVisits = Number(dayConfig.max_visits ?? 20)

    // Patients assignés à ce jour : fixes en premier, puis les plus contraints (fenêtre dispo étroite)
    const todayPatients = (patientsByDay.get(day.key) ?? []).sort((a, b) => {
      if (a.is_fixed !== b.is_fixed) return a.is_fixed ? -1 : 1
      const flexA = availableMinutesInDay(dayStart, dayEnd, therapistBlocked, (a.availability?.[day.key] ?? {}).blocked_windows)
      const flexB = availableMinutesInDay(dayStart, dayEnd, therapistBlocked, (b.availability?.[day.key] ?? {}).blocked_windows)
      return flexA - flexB
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

        const partialAbsence = partialAbsenceMap.get(`${p.id}|${day.date}`) ?? []
        if (partialAbsence.length && isInsideBlocked(startVisit, endVisit, partialAbsence)) return false

        return true
      })

      if (!candidates.length) {
        // Sauter par-dessus la prochaine plage bloquée du thérapeute et réessayer
        const nextBlock = therapistBlocked
          .filter((b) => b.end > currentTime)
          .sort((a, b) => a.end - b.end)[0]
        if (nextBlock && nextBlock.end < dayEnd) {
          currentTime = nextBlock.end
          continue
        }
        break
      }

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

    // ── Optimisation 2-opt de l'ordre des visites ──────────────────────────
    if (visits.length >= 3) {
      const patientById = new Map(patients.map((p) => [p.id, p]))
      const greedyPatients = visits.map((v) => patientById.get(v.patient_id)).filter(Boolean)
      const routeCtx = {
        startLat: dayStartLat, startLng: dayStartLng,
        dayStart, dayEnd, dayKey: day.key, dayDate: day.date,
        therapistBlocked, partialAbsenceMap,
        travel, travelBuffer, sessionBuffer,
      }
      const optimized = twoOptImprove(greedyPatients, routeCtx)
      if (optimized.some((p, i) => p.id !== greedyPatients[i].id)) {
        const rebuilt = computeRouteOrder(optimized, routeCtx)
        if (rebuilt) {
          visits.length = 0
          for (const { patient: p, visitStart, visitEnd, travelMin, travelKm } of rebuilt.schedule) {
            visits.push({
              patient_id:           p.id,
              patient_name:         p.full_name,
              address:              p.address,
              lat:                  p.lat,
              lng:                  p.lng,
              start_time:           formatMinutes(visitStart),
              end_time:             formatMinutes(visitEnd),
              session_duration_min: Number(p.session_duration_min ?? 30),
              estimated_travel_min: travelMin + travelBuffer,
              estimated_km:         travelKm,
              is_fixed:             p.is_fixed ?? false,
              done:                 false,
            })
          }
          currentLat = optimized[optimized.length - 1].lat
          currentLng = optimized[optimized.length - 1].lng
        }
      }
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
