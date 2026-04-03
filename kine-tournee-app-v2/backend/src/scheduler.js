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

function addMinutes(hhmm, amount) {
  const base = parseMinutes(hhmm)
  return formatMinutes(base + amount)
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

function estimateTravelMinutes(fromLat, fromLng, toLat, toLng) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => typeof v !== 'number')) {
    return 20
  }

  const dx = fromLat - toLat
  const dy = fromLng - toLng
  const distance = Math.sqrt(dx * dx + dy * dy)

  return Math.max(5, Math.round(distance * 900))
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

function chooseCandidate(candidates, currentLat, currentLng) {
  if (!candidates.length) return null

  return candidates
    .map((patient) => ({
      patient,
      score: estimateTravelMinutes(currentLat, currentLng, patient.lat, patient.lng),
    }))
    .sort((a, b) => a.score - b.score)[0].patient
}

export function generateSchedule({
  weekStart,
  therapist,
  weeklyConfig,
  patients,
  travelBuffer = 10,
  sessionBuffer = 5,
}) {
  const days = getDayDates(weekStart)
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
      })
      continue
    }

    const dayStart = parseMinutes(dayConfig.work_start)
    const dayEnd = parseMinutes(dayConfig.work_end)
    const therapistBlocked = normalizeWindows(dayConfig.blocked_windows)

    let currentTime = dayStart
    let currentLat = dayConfig.start_lat ?? therapist.default_start_lat
    let currentLng = dayConfig.start_lng ?? therapist.default_start_lng
    const visits = []
    const maxVisits = Number(dayConfig.max_visits ?? 20)

    for (let i = 0; i < maxVisits; i += 1) {
      const candidates = patients.filter((p) => {
        const remaining = remainingVisits.get(p.id) ?? 0
        if (!p.active || remaining <= 0) return false

        const patientDay = (p.availability ?? {})[day.key] ?? {}
        if (patientDay.unavailable === true) return false

        const travel = estimateTravelMinutes(currentLat, currentLng, p.lat, p.lng) + travelBuffer
        const duration = Number(p.session_duration_min ?? 30)
        const startVisit = currentTime + travel
        const endVisit = startVisit + duration

        if (endVisit > dayEnd) return false
        if (isInsideBlocked(startVisit, endVisit, therapistBlocked)) return false

        const patientAvailable = normalizeWindows(patientDay.available_windows)
        const patientBlocked = normalizeWindows(patientDay.blocked_windows)

        if (!isInsideAvailable(startVisit, endVisit, patientAvailable)) return false
        if (isInsideBlocked(startVisit, endVisit, patientBlocked)) return false

        return true
      })

      const chosen = chooseCandidate(candidates, currentLat, currentLng)
      if (!chosen) break

      const travel = estimateTravelMinutes(currentLat, currentLng, chosen.lat, chosen.lng) + travelBuffer
      const duration = Number(chosen.session_duration_min ?? 30)
      const visitStart = currentTime + travel
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
        estimated_travel_min: travel,
      })

      remainingVisits.set(chosen.id, (remainingVisits.get(chosen.id) ?? 1) - 1)
      currentTime = visitEnd + sessionBuffer
      currentLat = chosen.lat
      currentLng = chosen.lng
    }

    const endTravel = estimateTravelMinutes(
      currentLat,
      currentLng,
      dayConfig.end_lat ?? therapist.default_end_lat,
      dayConfig.end_lng ?? therapist.default_end_lng
    )

    result.push({
      day: day.key,
      dow: day.dow,
      date: day.date,
      start_address: dayConfig.start_address,
      end_address: dayConfig.end_address,
      estimated_return_travel_min: endTravel,
      visits,
    })
  }

  return {
    week_start: weekStart,
    generated_at: new Date().toISOString(),
    days: result,
  }
}
