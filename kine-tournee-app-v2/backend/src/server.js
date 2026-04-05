import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { getSupabaseAdmin } from './supabase.js'
import { generateSchedule } from './scheduler.js'

const app = express()
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? '*' }))
app.use(express.json())

const supabase = getSupabaseAdmin()

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Kiné Tournée V2 API' })
})

// ── Bootstrap ─────────────────────────────────────────────────────────────────
app.get('/api/bootstrap', async (_req, res) => {
  const [{ data: therapist, error: therapistError }, { data: weeklyConfig, error: weeklyError }] =
    await Promise.all([
      supabase.from('therapist_profile').select('*').limit(1).maybeSingle(),
      supabase.from('therapist_day_config').select('*').order('day_index', { ascending: true }),
    ])

  if (therapistError || weeklyError) {
    return res.status(500).json({ error: therapistError?.message || weeklyError?.message })
  }

  const weekly = Object.fromEntries((weeklyConfig ?? []).map((row) => [row.day_key, row]))
  res.json({ therapist, weeklyConfig: weekly })
})

// ── Patients ──────────────────────────────────────────────────────────────────
app.get('/api/patients', async (_req, res) => {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('full_name', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/patients', async (req, res) => {
  const { data, error } = await supabase
    .from('patients')
    .insert(req.body)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

app.put('/api/patients/:id', async (req, res) => {
  // On extrait uniquement les colonnes connues pour éviter les erreurs Supabase
  const {
    full_name, address, lat, lng, phone, doctor_name,
    session_duration_min, sessions_per_week, active, availability,
    notes, is_fixed,
    prescription_sessions_total, prescription_sessions_done,
  } = req.body

  const patch = {
    ...(full_name               !== undefined && { full_name }),
    ...(address                 !== undefined && { address }),
    ...(lat                     !== undefined && { lat }),
    ...(lng                     !== undefined && { lng }),
    ...(phone                   !== undefined && { phone }),
    ...(doctor_name             !== undefined && { doctor_name }),
    ...(session_duration_min    !== undefined && { session_duration_min }),
    ...(sessions_per_week       !== undefined && { sessions_per_week }),
    ...(active                  !== undefined && { active }),
    ...(availability            !== undefined && { availability }),
    ...(notes                   !== undefined && { notes }),
    ...(is_fixed                !== undefined && { is_fixed }),
    ...(prescription_sessions_total !== undefined && { prescription_sessions_total }),
    ...(prescription_sessions_done  !== undefined && { prescription_sessions_done }),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('patients')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.delete('/api/patients/:id', async (req, res) => {
  const { error } = await supabase.from('patients').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// ── Absences patients ─────────────────────────────────────────────────────────
// GET /api/absences?weekStart=YYYY-MM-DD  → absences pour la semaine (±7j)
app.get('/api/absences', async (req, res) => {
  const { weekStart } = req.query
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })

  const start = weekStart
  const end = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('patient_absences')
    .select('*')
    .gte('absence_date', start)
    .lte('absence_date', end)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/patients/:id/absences → toutes les absences d'un patient
app.get('/api/patients/:id/absences', async (req, res) => {
  const { data, error } = await supabase
    .from('patient_absences')
    .select('*')
    .eq('patient_id', req.params.id)
    .order('absence_date', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/patients/:id/absences  body: { absence_date, reason }
app.post('/api/patients/:id/absences', async (req, res) => {
  const { data, error } = await supabase
    .from('patient_absences')
    .upsert({ patient_id: req.params.id, ...req.body }, { onConflict: 'patient_id,absence_date' })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

// DELETE /api/patients/:id/absences/:date
app.delete('/api/patients/:id/absences/:date', async (req, res) => {
  const { error } = await supabase
    .from('patient_absences')
    .delete()
    .eq('patient_id', req.params.id)
    .eq('absence_date', req.params.date)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// ── Suivi séances effectuées ──────────────────────────────────────────────────
// GET /api/completions?weekStart=YYYY-MM-DD
app.get('/api/completions', async (req, res) => {
  const { weekStart } = req.query
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })

  const end = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('visit_completions')
    .select('*')
    .gte('visit_date', weekStart)
    .lte('visit_date', end)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/completions  body: { patient_id, visit_date, done, notes }
app.post('/api/completions', async (req, res) => {
  const { data, error } = await supabase
    .from('visit_completions')
    .upsert(
      { ...req.body, updated_at: new Date().toISOString() },
      { onConflict: 'patient_id,visit_date' }
    )
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── Profil et config thérapeute ───────────────────────────────────────────────
app.put('/api/therapist/profile', async (req, res) => {
  const { data, error } = await supabase
    .from('therapist_profile')
    .upsert({ id: 1, ...req.body, updated_at: new Date().toISOString() })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.put('/api/therapist/day-config/:dayKey', async (req, res) => {
  const payload = { ...req.body, day_key: req.params.dayKey, updated_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from('therapist_day_config')
    .upsert(payload, { onConflict: 'day_key' })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

// ── Génération du planning ────────────────────────────────────────────────────
app.post('/api/schedule/generate', async (req, res) => {
  const { weekStart } = req.body
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })

  const weekEnd = new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000)
    .toISOString()
    .slice(0, 10)

  const [
    { data: therapist, error: therapistError },
    { data: weeklyRows, error: weeklyError },
    { data: patients, error: patientsError },
    { data: absences, error: absencesError },
  ] = await Promise.all([
    supabase.from('therapist_profile').select('*').limit(1).maybeSingle(),
    supabase.from('therapist_day_config').select('*').order('day_index', { ascending: true }),
    supabase.from('patients').select('*').eq('active', true),
    supabase
      .from('patient_absences')
      .select('patient_id,absence_date')
      .gte('absence_date', weekStart)
      .lte('absence_date', weekEnd),
  ])

  if (therapistError || weeklyError || patientsError || absencesError) {
    return res.status(500).json({
      error:
        therapistError?.message ||
        weeklyError?.message ||
        patientsError?.message ||
        absencesError?.message,
    })
  }

  try {
    const weeklyConfig = Object.fromEntries((weeklyRows ?? []).map((row) => [row.day_key, row]))
    const absentSet = new Set((absences ?? []).map((a) => `${a.patient_id}|${a.absence_date}`))

    const schedule = await generateSchedule({
      weekStart,
      therapist,
      weeklyConfig,
      patients: patients ?? [],
      travelBuffer: therapist?.travel_buffer_min ?? 10,
      sessionBuffer: therapist?.session_buffer_min ?? 5,
      absentSet,
    })

    const { error: insertError } = await supabase.from('generated_schedules').insert({
      week_start: weekStart,
      payload: schedule,
    })

    if (insertError) return res.status(500).json({ error: insertError.message })

    res.json(schedule)
  } catch (error) {
    res.status(500).json({ error: error.message || 'Échec de la génération du planning' })
  }
})

// GET /api/schedule?weekStart=YYYY-MM-DD
app.get('/api/schedule', async (req, res) => {
  const weekStart = req.query.weekStart
  if (!weekStart) return res.status(400).json({ error: 'weekStart query param required' })

  const { data, error } = await supabase
    .from('generated_schedules')
    .select('*')
    .eq('week_start', weekStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data?.payload ?? { week_start: weekStart, days: [] })
})

// ── Sauvegarde planning modifié (après drag & drop) ───────────────────────────
app.post('/api/schedule/save', async (req, res) => {
  const { weekStart, schedule } = req.body
  if (!weekStart || !schedule) return res.status(400).json({ error: 'weekStart et schedule requis' })

  const { error } = await supabase.from('generated_schedules').insert({
    week_start: weekStart,
    payload: schedule,
  })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

const PORT = Number(process.env.PORT || 4000)
app.listen(PORT, () => {
  console.log(`Kiné Tournée V2 API → http://localhost:${PORT}`)
})
