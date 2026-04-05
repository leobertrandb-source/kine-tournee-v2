// Toujours utiliser des URLs relatives sur Vercel (même domaine).
const _raw = import.meta.env.VITE_API_URL || ''
const API_URL = _raw.includes('localhost') ? _raw : ''

async function req(method, path, body) {
  // Attacher le JWT Supabase pour l'authentification backend
  let authHeader = {}
  try {
    const { supabase } = await import('./supabase.js')
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) authHeader = { Authorization: `Bearer ${session.access_token}` }
  } catch { /* pas de session */ }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export const api = {
  // Bootstrap
  bootstrap: () => req('GET', '/api/bootstrap'),

  // Patients
  getPatients: () => req('GET', '/api/patients'),
  createPatient: (data) => req('POST', '/api/patients', data),
  updatePatient: (id, data) => req('PUT', `/api/patients/${id}`, data),
  deletePatient: (id) => req('DELETE', `/api/patients/${id}`),

  // Absences
  getAbsences: (weekStart) => req('GET', `/api/absences?weekStart=${encodeURIComponent(weekStart)}`),
  getPatientAbsences: (patientId) => req('GET', `/api/patients/${patientId}/absences`),
  addAbsence: (patientId, data) => req('POST', `/api/patients/${patientId}/absences`, data),
  deleteAbsence: (patientId, date) => req('DELETE', `/api/patients/${patientId}/absences/${date}`),

  // Suivi séances
  getCompletions: (weekStart) =>
    req('GET', `/api/completions?weekStart=${encodeURIComponent(weekStart)}`),
  upsertCompletion: (data) => req('POST', '/api/completions', data),

  // Thérapeute
  updateTherapistProfile: (data) => req('PUT', '/api/therapist/profile', data),
  updateDayConfig: (dayKey, data) => req('PUT', `/api/therapist/day-config/${dayKey}`, data),

  // Planning
  generateSchedule: (weekStart) => req('POST', '/api/schedule/generate', { weekStart }),
  getSchedule: (weekStart) => req('GET', `/api/schedule?weekStart=${encodeURIComponent(weekStart)}`),
  saveSchedule: (weekStart, schedule) => req('POST', '/api/schedule/save', { weekStart, schedule }),
  getScheduleHistory: () => req('GET', '/api/schedules/history'),
}
