import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './_lib/supabase.js'
import { generateSchedule } from './_lib/scheduler.js'

const app = express()
app.use(cors())
app.use(express.json())

const adminSupabase = getSupabaseAdmin()

// Décode le payload JWT localement — pas d'appel réseau, évite les timeouts
function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) return null
    return payload
  } catch { return null }
}

// ── Middleware auth ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/api/') return next()

  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Non authentifié' })

  const payload = decodeJwt(token)
  if (!payload) return res.status(401).json({ error: 'Session expirée — reconnectez-vous' })

  req.userId = payload.sub

  // Client Supabase avec le JWT de l'utilisateur → RLS s'applique automatiquement
  req.db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  )
  next()
})

app.get('/api/', (_req, res) => res.json({ ok: true }))
app.get('/',    (_req, res) => res.json({ ok: true }))

// ── Bootstrap ─────────────────────────────────────────────────────────────────
app.get('/api/bootstrap', async (req, res) => {
  const [{ data: therapist, error: e1 }, { data: weeklyConfig, error: e2 }] = await Promise.all([
    req.db.from('therapist_profile').select('*').eq('user_id', req.userId).maybeSingle(),
    req.db.from('therapist_day_config').select('*').eq('user_id', req.userId).order('day_index'),
  ])
  if (e1 || e2) return res.status(500).json({ error: e1?.message || e2?.message })
  const weekly = Object.fromEntries((weeklyConfig ?? []).map((r) => [r.day_key, r]))
  res.json({ therapist, weeklyConfig: weekly })
})

// ── Patients ──────────────────────────────────────────────────────────────────
app.get('/api/patients', async (req, res) => {
  const { data, error } = await req.db.from('patients').select('*').order('full_name')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/patients', async (req, res) => {
  const body = { ...req.body, user_id: req.userId }
  // 'name' is the original NOT NULL column; keep it in sync with full_name
  if (body.full_name && !body.name) body.name = body.full_name
  const { data, error } = await req.db.from('patients').insert(body).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

app.put('/api/patients/:id', async (req, res) => {
  const {
    full_name, address, lat, lng, phone, email, doctor_name,
    session_duration_min, sessions_per_week, active, availability,
    notes, is_fixed, prescription_sessions_total, prescription_sessions_done,
    sms_first_name, tournee, time_preference,
  } = req.body
  const patch = {
    ...(full_name               !== undefined && { full_name, name: full_name }),
    ...(address                 !== undefined && { address }),
    ...(lat                     !== undefined && { lat }),
    ...(lng                     !== undefined && { lng }),
    ...(phone                   !== undefined && { phone }),
    ...(email                   !== undefined && { email }),
    ...(doctor_name             !== undefined && { doctor_name }),
    ...(session_duration_min    !== undefined && { session_duration_min }),
    ...(sessions_per_week       !== undefined && { sessions_per_week }),
    ...(active                  !== undefined && { active }),
    ...(availability            !== undefined && { availability }),
    ...(notes                   !== undefined && { notes }),
    ...(is_fixed                !== undefined && { is_fixed }),
    ...(prescription_sessions_total !== undefined && { prescription_sessions_total }),
    ...(prescription_sessions_done  !== undefined && { prescription_sessions_done }),
    ...(sms_first_name          !== undefined && { sms_first_name }),
    ...(tournee                 !== undefined && { tournee }),
    ...(time_preference         !== undefined && { time_preference }),
  }
  const { data, error } = await req.db.from('patients').update(patch).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.delete('/api/patients/:id', async (req, res) => {
  const { error } = await req.db.from('patients').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// ── Absences ──────────────────────────────────────────────────────────────────
app.get('/api/absences', async (req, res) => {
  const { weekStart } = req.query
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })
  const end = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await req.db.from('patient_absences').select('*').gte('absence_date', weekStart).lte('absence_date', end)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.get('/api/patients/:id/absences', async (req, res) => {
  const { data, error } = await req.db.from('patient_absences').select('*').eq('patient_id', req.params.id).order('absence_date')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/patients/:id/absences', async (req, res) => {
  const { data, error } = await req.db.from('patient_absences')
    .upsert({ patient_id: req.params.id, user_id: req.userId, ...req.body }, { onConflict: 'patient_id,absence_date' }).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

app.delete('/api/patients/:id/absences/:date', async (req, res) => {
  const { error } = await req.db.from('patient_absences').delete().eq('patient_id', req.params.id).eq('absence_date', req.params.date)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// ── Completions ───────────────────────────────────────────────────────────────
app.get('/api/completions', async (req, res) => {
  const { weekStart } = req.query
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })
  const end = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await req.db.from('visit_completions').select('*').gte('visit_date', weekStart).lte('visit_date', end)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/completions', async (req, res) => {
  const { data, error } = await req.db.from('visit_completions')
    .upsert({ ...req.body, user_id: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'patient_id,visit_date' }).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── Thérapeute ────────────────────────────────────────────────────────────────
app.put('/api/therapist/profile', async (req, res) => {
  const { data, error } = await req.db.from('therapist_profile')
    .upsert({ ...req.body, user_id: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.put('/api/therapist/day-config/:dayKey', async (req, res) => {
  const { data, error } = await req.db.from('therapist_day_config')
    .upsert({ ...req.body, day_key: req.params.dayKey, user_id: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day_key' }).select().single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── Planning ──────────────────────────────────────────────────────────────────
app.post('/api/schedule/generate', async (req, res) => {
  const { weekStart } = req.body
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })
  const weekEnd = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10)

  const [
    { data: therapist, error: e1 },
    { data: weeklyRows, error: e2 },
    { data: patients, error: e3 },
    { data: absences, error: e4 },
  ] = await Promise.all([
    req.db.from('therapist_profile').select('*').eq('user_id', req.userId).maybeSingle(),
    req.db.from('therapist_day_config').select('*').eq('user_id', req.userId).order('day_index'),
    req.db.from('patients').select('*').eq('active', true),
    req.db.from('patient_absences').select('patient_id,absence_date,start_time,end_time').gte('absence_date', weekStart).lte('absence_date', weekEnd),
  ])
  if (e1 || e2 || e3 || e4) return res.status(500).json({ error: e1?.message || e2?.message || e3?.message || e4?.message })

  try {
    const weeklyConfig = Object.fromEntries((weeklyRows ?? []).map((r) => [r.day_key, r]))
    const schedule = await generateSchedule({
      weekStart, therapist, weeklyConfig, patients: patients ?? [],
      travelBuffer: therapist?.travel_buffer_min ?? 10,
      sessionBuffer: therapist?.session_buffer_min ?? 5,
      absences: absences ?? [],
    })
    const { error: insertError } = await req.db.from('generated_schedules')
      .insert({ week_start: weekStart, payload: schedule, user_id: req.userId })
    if (insertError) return res.status(500).json({ error: insertError.message })
    res.json(schedule)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Échec génération' })
  }
})

app.get('/api/schedule', async (req, res) => {
  const { weekStart } = req.query
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })
  const { data, error } = await req.db.from('generated_schedules').select('*')
    .eq('week_start', weekStart).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data?.payload ?? { week_start: weekStart, days: [] })
})

app.post('/api/schedule/save', async (req, res) => {
  const { weekStart, schedule } = req.body
  if (!weekStart || !schedule) return res.status(400).json({ error: 'weekStart et schedule requis' })
  const { error } = await req.db.from('generated_schedules')
    .insert({ week_start: weekStart, payload: schedule, user_id: req.userId })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

app.get('/api/schedules/history', async (req, res) => {
  const { data, error } = await req.db.from('generated_schedules')
    .select('id, week_start, created_at, payload').order('week_start', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  const byWeek = new Map()
  for (const row of data) { if (!byWeek.has(row.week_start)) byWeek.set(row.week_start, row) }
  res.json([...byWeek.values()])
})

export default app
