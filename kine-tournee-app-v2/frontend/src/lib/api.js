const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

async function req(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export const api = {
  bootstrap: () => req('GET', '/api/bootstrap'),
  getPatients: () => req('GET', '/api/patients'),
  createPatient: (data) => req('POST', '/api/patients', data),
  updatePatient: (id, data) => req('PUT', `/api/patients/${id}`, data),
  deletePatient: (id) => req('DELETE', `/api/patients/${id}`),
  updateTherapistProfile: (data) => req('PUT', '/api/therapist/profile', data),
  updateDayConfig: (dayKey, data) => req('PUT', `/api/therapist/day-config/${dayKey}`, data),
  generateSchedule: (weekStart) => req('POST', '/api/schedule/generate', { weekStart }),
  getSchedule: (weekStart) => req('GET', `/api/schedule?weekStart=${encodeURIComponent(weekStart)}`),
}
