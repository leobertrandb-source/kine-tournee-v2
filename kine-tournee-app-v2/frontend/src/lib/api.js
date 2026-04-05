import { supabase } from './supabase.js'

// URLs relatives sur Vercel (même domaine). VITE_API_URL uniquement en dev local.
const _raw = import.meta.env.VITE_API_URL || ''
const API_URL = _raw.includes('localhost') ? _raw : ''

async function req(method, path, body) {
  // Attacher le JWT Supabase à chaque requête
  let authHeader = {}
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      authHeader = { Authorization: `Bearer ${session.access_token}` }
    }
  } catch { /* pas de session active */ }

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
  bootstrap: () => req('GET', '/api/bootstrap'),

  getPatients: () => req('GET', '/api/patients'),
  createPatient: (data) => req('POST', '/api/patients', data),
  updatePatient: (id, data) => req('PUT', `/api/patients/${id}`, data),
  deletePatient: (id) => req('DELETE', `/api/patients/${id}`),

  getAbsences: (weekStart) => req('GET', `/api/absences?weekStart=${encodeURIComponent(weekStart)}`),
  getPatientAbsences: (patientId) => req('GET', `/api/patients/${patientId}/absences`),
  addAbsence: (patientId, data) => req('POST', `/api/patients/${patientId}/absences`, data),
  deleteAbsence: (patientId, date) => req('DELETE', `/api/patients/${patientId}/absences/${date}`),

  getCompletions: (weekStart) => req('GET', `/api/completions?weekStart=${encodeURIComponent(weekStart)}`),
  upsertCompletion: (data) => req('POST', '/api/completions', data),

  updateTherapistProfile: (data) => req('PUT', '/api/therapist/profile', data),
  updateDayConfig: (dayKey, data) => req('PUT', `/api/therapist/day-config/${dayKey}`, data),

  generateSchedule: (weekStart) => req('POST', '/api/schedule/generate', { weekStart }),
  getSchedule: (weekStart) => req('GET', `/api/schedule?weekStart=${encodeURIComponent(weekStart)}`),
  saveSchedule: (weekStart, schedule) => req('POST', '/api/schedule/save', { weekStart, schedule }),
  getScheduleHistory: () => req('GET', '/api/schedules/history'),
}
