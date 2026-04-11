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
 * totalTravel inclut le trajet de retour (endLat/endLng) pour que les
 * algorithmes d'optimisation placent naturellement les patients proches
 * du domicile/cabinet en dernière position.
 */
function computeRouteOrder(orderedPatients, { startLat, startLng, endLat, endLng, dayStart, dayEnd, dayKey, dayDate, therapistBlocked, partialAbsenceMap, travel, travelBuffer, sessionBuffer }) {
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

  // Inclure le trajet de retour dans le coût total — indispensable pour que
  // 2-opt / or-opt placent les patients proches du point d'arrivée en dernier
  if (endLat && endLng && schedule.length > 0) {
    const { minutes: returnMin } = travel(lat, lng, endLat, endLng)
    totalTravel += returnMin
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
        if (r && r.totalTravel < bestResult.totalTravel - 0.5) {
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

/**
 * Or-opt : déplace chaque patient non-fixe à la meilleure position de la route.
 * Complémentaire au 2-opt — capture les "détours" sur des patients isolés que
 * le 2-opt ne peut pas corriger en inversant des segments.
 */
function orOptImprove(patients, ctx) {
  if (patients.length < 3) return patients
  const fixedCount = patients.filter((p) => p.is_fixed).length

  let best = [...patients]
  let bestResult = computeRouteOrder(best, ctx)
  if (!bestResult) return patients

  let improved = true
  while (improved) {
    improved = false
    for (let i = fixedCount; i < best.length && !improved; i++) {
      const node = best[i]
      const rest = best.filter((_, idx) => idx !== i)
      for (let j = 0; j <= rest.length && !improved; j++) {
        if (j === i) continue
        const candidate = [...rest.slice(0, j), node, ...rest.slice(j)]
        const r = computeRouteOrder(candidate, ctx)
        if (r && r.totalTravel < bestResult.totalTravel - 0.5) {
          best = candidate
          bestResult = r
          improved = true
        }
      }
    }
  }
  return best
}

/**
 * Or-opt-2 : déplace des paires de patients consécutifs à la meilleure position.
 * Utile quand deux patients adjacents forment un détour qu'or-opt ne détecte pas.
 */
function orOpt2Improve(patients, ctx) {
  if (patients.length < 4) return patients
  const fixedCount = patients.filter((p) => p.is_fixed).length

  let best = [...patients]
  let bestResult = computeRouteOrder(best, ctx)
  if (!bestResult) return patients

  let improved = true
  while (improved) {
    improved = false
    for (let i = fixedCount; i < best.length - 1 && !improved; i++) {
      const pair = [best[i], best[i + 1]]
      const rest = best.filter((_, idx) => idx !== i && idx !== i + 1)
      for (let j = 0; j <= rest.length && !improved; j++) {
        const candidate = [...rest.slice(0, j), ...pair, ...rest.slice(j)]
        const r = computeRouteOrder(candidate, ctx)
        if (r && r.totalTravel < bestResult.totalTravel - 0.5) {
          best = candidate
          bestResult = r
          improved = true
        }
      }
    }
  }
  return best
}

const TOURNEE_A = ['monday', 'wednesday']
const TOURNEE_B = ['tuesday', 'thursday']

/**
 * Teste si un point (lat, lng) est à l'intérieur d'un polygone.
 * Algorithme ray casting — O(n) en nombre de sommets.
 * @param polygon - [{lat, lng}, ...]
 */
function pointInPolygon(lat, lng, polygon) {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const { lat: yi, lng: xi } = polygon[i]
    const { lat: yj, lng: xj } = polygon[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

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
 * Priorité d'assignation :
 *  1. Tournée explicite (patient.tournee = 'A'/'B')
 *  2. Zone dessinée manuellement (dayZones) — si le patient est dans un polygone
 *  3. K-means géographique (2x/sem sans coordonnées de zone)
 *  4. Round-robin fallback
 *
 * @param startLocByDay - { monday:{lat,lng}, tuesday:{lat,lng}, … }
 * @param dayZones      - { monday:[{lat,lng},...], tuesday:[...], … }
 */
function preAssignDays(patients, enabledDays, absentSet, startLocByDay = {}, dayZones = {}) {
  const assignments = new Map()
  let autoTourneeCounter = 0

  const aLoc = startLocByDay['monday']
  const bLoc = startLocByDay['tuesday']
  const geoAvailable = !!(
    aLoc?.lat && aLoc?.lng && bLoc?.lat && bLoc?.lng &&
    (aLoc.lat !== bLoc.lat || aLoc.lng !== bLoc.lng)
  )

  // Pré-calculer les zones k-means pour les patients sans zone dessinée
  const autoPatients2x = patients.filter(
    (p) => p.active && !p.tournee && Number(p.sessions_per_week ?? 1) === 2 && p.lat && p.lng
  )
  const zoneMap = geoAvailable ? kmeansZones(autoPatients2x, aLoc, bLoc) : new Map()

  // Jours qui ont une zone dessinée valide
  const daysWithZone = enabledDays.filter((d) => (dayZones[d.key]?.length ?? 0) >= 3)

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
    } else if (daysWithZone.length > 0 && patient.lat && patient.lng) {
      // Zones dessinées : le patient appartient aux jours dont le polygone le contient
      const matchingZoneDays = daysWithZone
        .filter((d) => pointInPolygon(patient.lat, patient.lng, dayZones[d.key]))
        .map((d) => d.key)
      if (matchingZoneDays.length > 0) {
        preferred = matchingZoneDays
      }
    }

    // Fallback k-means (uniquement si pas de zone dessinée ni tournée explicite)
    if (!preferred && n === 2) {
      if (zoneMap.has(patient.id)) {
        preferred = zoneMap.get(patient.id) === 0 ? TOURNEE_A : TOURNEE_B
      } else {
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

  // ── Zones dessinées par le kiné (polygones par jour) ─────────────────────
  const dayZones = {}
  days.forEach((day) => {
    const cfg = weeklyConfig[day.key]
    if (cfg?.zone_polygon?.length >= 3) dayZones[day.key] = cfg.zone_polygon
  })

  // ── Pré-assignation des patients aux jours (règle 48h + géographie) ───────
  const dayAssignments = preAssignDays(patients, enabledDays, fullDayAbsenceSet, startLocByDay, dayZones)

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
    // Déclarés ici pour être accessibles dans le greedy ET l'optimisation
    const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
    const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
    let currentTime = dayStart
    let currentLat  = dayStartLat
    let currentLng  = dayStartLng
    const visits    = []
    const maxVisits = Number(dayConfig.max_visits ?? 20)

    // Patients assignés à ce jour :
    // 1. Fixes en premier
    // 2. Plus contraints (fenêtre dispo étroite) en priorité
    // 3. Préférence horaire : matin avant indifférent avant après-midi
    const prefOrder = { morning: 0, any: 1, afternoon: 2 }
    const todayPatients = (patientsByDay.get(day.key) ?? []).sort((a, b) => {
      if (a.is_fixed !== b.is_fixed) return a.is_fixed ? -1 : 1
      const flexA = availableMinutesInDay(dayStart, dayEnd, therapistBlocked, (a.availability?.[day.key] ?? {}).blocked_windows)
      const flexB = availableMinutesInDay(dayStart, dayEnd, therapistBlocked, (b.availability?.[day.key] ?? {}).blocked_windows)
      if (flexA !== flexB) return flexA - flexB
      return (prefOrder[a.time_preference ?? 'any'] ?? 1) - (prefOrder[b.time_preference ?? 'any'] ?? 1)
    })

    // Ensemble des patients déjà planifiés ce jour (anti-doublon)
    const visitedToday = new Set()
    // Compteur de sécurité séparé pour éviter une boucle infinie
    // (le nombre de visites réelles est suivi par visitedToday.size)
    let safetyIter = 0
    const maxSafetyIter = maxVisits * 3

    while (visitedToday.size < maxVisits && visitedToday.size < todayPatients.length && safetyIter++ < maxSafetyIter) {
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

      // Fixes en tête, sinon score = trajet(actuel→p) + 0.4 × trajet(p→arrivée)
      // → attire les patients proches du point de retour vers la fin de la tournée
      const endWeight = endLat && endLng ? 0.4 : 0
      const scored = candidates.map((p) => {
        const { minutes: toP } = travel(currentLat, currentLng, p.lat, p.lng)
        const { minutes: toEnd } = endLat && endLng ? travel(p.lat, p.lng, endLat, endLng) : { minutes: 0 }
        return { patient: p, score: p.is_fixed ? -Infinity : toP + endWeight * toEnd }
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

    // ── Optimisation de l'ordre des visites : 2-opt → or-opt → or-opt-2 ───────
    if (visits.length >= 3) {
      const patientById = new Map(patients.map((p) => [p.id, p]))
      const greedyPatients = visits.map((v) => patientById.get(v.patient_id)).filter(Boolean)
      const routeCtx = {
        startLat: dayStartLat, startLng: dayStartLng,
        endLat, endLng,
        dayStart, dayEnd, dayKey: day.key, dayDate: day.date,
        therapistBlocked, partialAbsenceMap,
        travel, travelBuffer, sessionBuffer,
      }
      // Chaîne d'optimisation : 2-opt (échanges de segments) → or-opt (relocation
      // de noeuds isolés) → or-opt-2 (relocation de paires) → 2-opt final
      let optimized = twoOptImprove(greedyPatients, routeCtx)
      optimized = orOptImprove(optimized, routeCtx)
      optimized = orOpt2Improve(optimized, routeCtx)
      optimized = twoOptImprove(optimized, routeCtx) // passe finale

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

    // Retour (endLat/endLng déclarés plus haut pour les optimisations)
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

  // ── Optimisation cross-jours : échange de patients entre jours jumeaux ───────
  // Essaie de déplacer un patient d'une journée à sa journée "jumelle" (Lun↔Mer,
  // Mar↔Jeu) si ça réduit le total km de la semaine. Respecte la règle 48h
  // implicitement : les jumeaux sont toujours à 2 jours d'écart.
  const TWIN_PAIRS = [['monday','wednesday'], ['tuesday','thursday']]

  for (const [dayA, dayB] of TWIN_PAIRS) {
    const idxA = result.findIndex((d) => d.day === dayA)
    const idxB = result.findIndex((d) => d.day === dayB)
    if (idxA < 0 || idxB < 0) continue

    const dayDataA = result[idxA]
    const dayDataB = result[idxB]
    if (!dayDataA.visits.length || !dayDataB.visits.length) continue

    const cfgA = weeklyConfig[dayA]
    const cfgB = weeklyConfig[dayB]
    if (!cfgA?.enabled || !cfgB?.enabled) continue

    const maxA = Number(cfgA.max_visits ?? 20)
    const maxB = Number(cfgB.max_visits ?? 20)

    const ctxA = {
      startLat: cfgA.start_lat ?? therapist?.default_start_lat,
      startLng: cfgA.start_lng ?? therapist?.default_start_lng,
      endLat: cfgA.end_lat ?? therapist?.default_end_lat,
      endLng: cfgA.end_lng ?? therapist?.default_end_lng,
      dayStart: parseMinutes(cfgA.work_start), dayEnd: parseMinutes(cfgA.work_end),
      dayKey: dayA, dayDate: dayDataA.date,
      therapistBlocked: normalizeWindows(cfgA.blocked_windows),
      partialAbsenceMap, travel, travelBuffer, sessionBuffer,
    }
    const ctxB = {
      startLat: cfgB.start_lat ?? therapist?.default_start_lat,
      startLng: cfgB.start_lng ?? therapist?.default_start_lng,
      endLat: cfgB.end_lat ?? therapist?.default_end_lat,
      endLng: cfgB.end_lng ?? therapist?.default_end_lng,
      dayStart: parseMinutes(cfgB.work_start), dayEnd: parseMinutes(cfgB.work_end),
      dayKey: dayB, dayDate: dayDataB.date,
      therapistBlocked: normalizeWindows(cfgB.blocked_windows),
      partialAbsenceMap, travel, travelBuffer, sessionBuffer,
    }

    const patientById = new Map(patients.map((p) => [p.id, p]))

    // Référence : totalTravel actuel des deux journées (inclut le retour)
    // On utilise les minutes plutôt que km pour cohérence avec computeRouteOrder
    const ptsA0 = dayDataA.visits.map((v) => patientById.get(v.patient_id)).filter(Boolean)
    const ptsB0 = dayDataB.visits.map((v) => patientById.get(v.patient_id)).filter(Boolean)
    const baseA = computeRouteOrder(ptsA0, ctxA)?.totalTravel ?? Infinity
    const baseB = computeRouteOrder(ptsB0, ctxB)?.totalTravel ?? Infinity
    let bestTotalTravel = baseA + baseB
    let bestA = null
    let bestB = null

    // Non-fixes sur chaque journée — candidats au transfert
    const nonFixedA = dayDataA.visits.filter((v) => !v.is_fixed)
    const nonFixedB = dayDataB.visits.filter((v) => !v.is_fixed)

    // Essaie de déplacer chaque patient de A vers B
    for (const vA of nonFixedA) {
      if (dayDataB.visits.length >= maxB) continue
      const pA = patientById.get(vA.patient_id)
      if (!pA) continue
      // Vérifier que le patient n'est pas indisponible sur dayB
      if ((pA.availability?.[dayB] ?? {}).unavailable === true) continue

      const newA = dayDataA.visits.filter((v) => v.patient_id !== vA.patient_id).map((v) => patientById.get(v.patient_id)).filter(Boolean)
      const newB = [...dayDataB.visits.map((v) => patientById.get(v.patient_id)).filter(Boolean), pA]

      const rA = newA.length ? computeRouteOrder(newA, ctxA) : { totalTravel: 0, schedule: [] }
      const rB = computeRouteOrder(newB, ctxB)
      if (!rA || !rB) continue

      const totalTravel = rA.totalTravel + rB.totalTravel
      if (totalTravel < bestTotalTravel - 1) {
        bestTotalTravel = totalTravel
        bestA = { patients: newA, result: rA, ctx: ctxA, dayIdx: idxA, dayKey: dayA, dayDate: dayDataA.date }
        bestB = { patients: newB, result: rB, ctx: ctxB, dayIdx: idxB, dayKey: dayB, dayDate: dayDataB.date }
      }
    }

    // Essaie de déplacer chaque patient de B vers A
    for (const vB of nonFixedB) {
      if (dayDataA.visits.length >= maxA) continue
      const pB = patientById.get(vB.patient_id)
      if (!pB) continue
      // Vérifier que le patient n'est pas indisponible sur dayA
      if ((pB.availability?.[dayA] ?? {}).unavailable === true) continue

      const newA = [...dayDataA.visits.map((v) => patientById.get(v.patient_id)).filter(Boolean), pB]
      const newB = dayDataB.visits.filter((v) => v.patient_id !== vB.patient_id).map((v) => patientById.get(v.patient_id)).filter(Boolean)

      const rA = computeRouteOrder(newA, ctxA)
      const rB = newB.length ? computeRouteOrder(newB, ctxB) : { totalTravel: 0, schedule: [] }
      if (!rA || !rB) continue

      const totalTravel = rA.totalTravel + rB.totalTravel
      if (totalTravel < bestTotalTravel - 1) {
        bestTotalTravel = totalTravel
        bestA = { patients: newA, result: rA, ctx: ctxA, dayIdx: idxA, dayKey: dayA, dayDate: dayDataA.date }
        bestB = { patients: newB, result: rB, ctx: ctxB, dayIdx: idxB, dayKey: dayB, dayDate: dayDataB.date }
      }
    }

    // Applique le meilleur échange trouvé, puis ré-optimise les deux journées
    if (bestA && bestB) {
      for (const { patients: pts, result: r, ctx, dayIdx, dayKey: dk, dayDate: dd } of [bestA, bestB]) {
        let optimized = twoOptImprove(pts, ctx)
        optimized = orOptImprove(optimized, ctx)
        optimized = orOpt2Improve(optimized, ctx)
        optimized = twoOptImprove(optimized, ctx)
        const rebuilt = pts.length ? computeRouteOrder(optimized, ctx) : { schedule: [] }
        if (!rebuilt) continue

        const newVisits = rebuilt.schedule.map(({ patient: p, visitStart, visitEnd, travelMin, travelKm }) => ({
          patient_id: p.id, patient_name: p.full_name, address: p.address,
          lat: p.lat, lng: p.lng,
          start_time: formatMinutes(visitStart), end_time: formatMinutes(visitEnd),
          session_duration_min: Number(p.session_duration_min ?? 30),
          estimated_travel_min: travelMin + travelBuffer,
          estimated_km: travelKm, is_fixed: p.is_fixed ?? false, done: false,
        }))

        const lastLat = optimized[optimized.length - 1]?.lat ?? ctx.startLat
        const lastLng = optimized[optimized.length - 1]?.lng ?? ctx.startLng
        const endLat = (weeklyConfig[dk]?.end_lat ?? therapist?.default_end_lat) ?? ctx.startLat
        const endLng = (weeklyConfig[dk]?.end_lng ?? therapist?.default_end_lng) ?? ctx.startLng
        const { minutes: retMin, km: retKm } = travel(lastLat, lastLng, endLat, endLng)

        result[dayIdx] = {
          ...result[dayIdx],
          visits: newVisits,
          stats: {
            total_visits: newVisits.length,
            total_travel_min: Math.round(newVisits.reduce((s, v) => s + v.estimated_travel_min, 0) + retMin),
            total_session_min: Math.round(newVisits.reduce((s, v) => s + v.session_duration_min, 0)),
            total_km: Math.round((newVisits.reduce((s, v) => s + (v.estimated_km ?? 0), 0) + retKm) * 10) / 10,
          },
        }
      }
    }
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
