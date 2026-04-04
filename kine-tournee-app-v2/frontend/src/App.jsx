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
  const [generating, setGenerating] = useState(false)
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

  // Charger le dernier planning sauvegardé au démarrage
  useEffect(() => {
    if (loading) return
    api.getSchedule(weekStart).then((s) => {
      if (s?.days?.length) setSchedule(s)
    }).catch(() => {})
  }, [loading, weekStart])

  const weekLabel = useMemo(() => {
    const d = new Date(`${weekStart}T00:00:00`)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  }, [weekStart])

  async function handleGenerate() {
    setError('')
    setGenerating(true)
    try {
      const generated = await api.generateSchedule(weekStart)
      setSchedule(generated)
      setTab('schedule')
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🩺</div>
          <div>Chargement…</div>
        </div>
      </div>
    )
  }

  const activePatients = patients.filter((p) => p.active).length

  return (
    <div className="container grid" id="app">
      {/* En-tête */}
      <div className="app-header no-print">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#184f3b' }}>
            🩺 Kiné Tournée
          </h1>
          <div className="small muted">Semaine du {weekLabel}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="stat-pill-sm">
            <span>{activePatients}</span>
            <span className="small muted">patients actifs</span>
          </div>
          {schedule?.week_stats && (
            <div className="stat-pill-sm">
              <span>{schedule.week_stats.total_visits}</span>
              <span className="small muted">visites planifiées</span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert-error no-print">{error}</div>}

      {/* Navigation */}
      <div className="tabs no-print">
        <button className={`tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>
          📋 Planning
        </button>
        <button className={`tab ${tab === 'patients' ? 'active' : ''}`} onClick={() => setTab('patients')}>
          👤 Patients{activePatients > 0 ? ` (${activePatients})` : ''}
        </button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          ⚙ Config
        </button>
      </div>

      {/* Pages */}
      {tab === 'schedule' && (
        <SchedulePage
          schedule={schedule}
          setSchedule={setSchedule}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
          onGenerate={handleGenerate}
          therapist={therapist}
          weeklyConfig={weeklyConfig}
          generating={generating}
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
