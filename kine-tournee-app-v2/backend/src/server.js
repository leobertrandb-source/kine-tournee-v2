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

app.get('/api/patients', async (_req, res) => {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('created_at', { ascending: false })

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
  const { data, error } = await supabase
    .from('patients')
    .update(req.body)
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

app.put('/api/therapist/profile', async (req, res) => {
  const { data, error } = await supabase
    .from('therapist_profile')
    .upsert({ id: 1, ...req.body })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.put('/api/therapist/day-config/:dayKey', async (req, res) => {
  const payload = { ...req.body, day_key: req.params.dayKey }
  const { data, error } = await supabase
    .from('therapist_day_config')
    .upsert(payload, { onConflict: 'day_key' })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.post('/api/schedule/generate', async (req, res) => {
  const { weekStart } = req.body
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' })

  const [
    { data: therapist, error: therapistError },
    { data: weeklyRows, error: weeklyError },
    { data: patients, error: patientsError },
  ] = await Promise.all([
    supabase.from('therapist_profile').select('*').limit(1).maybeSingle(),
    supabase.from('therapist_day_config').select('*').order('day_index', { ascending: true }),
    supabase.from('patients').select('*').eq('active', true),
  ])

  if (therapistError || weeklyError || patientsError) {
    return res.status(500).json({ error: therapistError?.message || weeklyError?.message || patientsError?.message })
  }

  try {
    const weeklyConfig = Object.fromEntries((weeklyRows ?? []).map((row) => [row.day_key, row]))
    const schedule = generateSchedule({
      weekStart,
      therapist,
      weeklyConfig,
      patients: patients ?? [],
      travelBuffer: therapist?.travel_buffer_min ?? 10,
      sessionBuffer: therapist?.session_buffer_min ?? 5,
    })

    const { error: insertError } = await supabase.from('generated_schedules').insert({
      week_start: weekStart,
      payload: schedule,
    })

    if (insertError) {
      return res.status(500).json({ error: insertError.message })
    }

    res.json(schedule)
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate schedule' })
  }
})

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

const PORT = Number(process.env.PORT || 4000)
app.listen(PORT, () => {
  console.log(`Kiné Tournée V2 API -> http://localhost:${PORT}`)
})
