import { useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import PatientsPage from './pages/PatientsPage'
import SettingsPage from './pages/SettingsPage'
import SchedulePage from './pages/SchedulePage'

function getMonday(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

export default function App() {
  const [tab, setTab] = useState('schedule')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [therapist, setTherapist] = useState(null)
  const [weeklyConfig, setWeeklyConfig] = useState({})
  const [patients, setPatients] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [weekStart, setWeekStart] = useState(getMonday())

  async function loadAll() {
    setError('')
    try {
      const [boot, allPatients] = await Promise.all([api.bootstrap(), api.getPatients()])
      setTherapist(boot.therapist)
      setWeeklyConfig(boot.weeklyConfig || {})
      setPatients(allPatients)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const weekLabel = useMemo(() => {
    const d = new Date(`${weekStart}T00:00:00`)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  }, [weekStart])

  async function handleGenerate() {
    setError('')
    try {
      const generated = await api.generateSchedule(weekStart)
      setSchedule(generated)
      setTab('schedule')
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <div className="container">Chargement…</div>

  return (
    <div className="container grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Kiné Tournée V2</h1>
          <div className="small">Base propre avec Supabase + génération par contraintes</div>
        </div>
        <div className="small">Semaine du {weekLabel}</div>
      </div>

      {error && <div className="card" style={{ color: '#a12a2a' }}>{error}</div>}

      <div className="tabs">
        <button className={`tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>Planning</button>
        <button className={`tab ${tab === 'patients' ? 'active' : ''}`} onClick={() => setTab('patients')}>Patients</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Configuration</button>
      </div>

      {tab === 'schedule' && (
        <SchedulePage
          schedule={schedule}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
          onGenerate={handleGenerate}
        />
      )}

      {tab === 'patients' && (
        <PatientsPage patients={patients} setPatients={setPatients} />
      )}

      {tab === 'settings' && (
        <SettingsPage
          therapist={therapist}
          setTherapist={setTherapist}
          weeklyConfig={weeklyConfig}
          setWeeklyConfig={setWeeklyConfig}
        />
      )}
    </div>
  )
}
