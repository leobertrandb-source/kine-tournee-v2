import { useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import PatientsPage from './pages/PatientsPage'
import SettingsPage from './pages/SettingsPage'
import SchedulePage from './pages/SchedulePage'
import DashboardPage from './pages/DashboardPage'
import NavigationPage from './pages/NavigationPage'
import HistoryPage from './pages/HistoryPage'
import { ToastProvider } from './components/Toast'
import { SkeletonCard } from './components/Skeleton'

function getMonday(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

const NAV = [
  { id: 'dashboard',   icon: '🏠', label: 'Accueil' },
  { id: 'schedule',    icon: '📋', label: 'Planning' },
  { id: 'navigation',  icon: '🧭', label: 'Navigation GPS' },
  { id: 'history',     icon: '📅', label: 'Historique' },
  { id: 'patients',    icon: '👤', label: 'Patients' },
  { id: 'settings',    icon: '⚙',  label: 'Config' },
]

function AppInner() {
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [therapist, setTherapist] = useState(null)
  const [weeklyConfig, setWeeklyConfig] = useState({})
  const [patients, setPatients] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [weekStart, setWeekStart] = useState(getMonday())
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  async function loadAll() {
    try {
      const [boot, allPatients] = await Promise.all([api.bootstrap(), api.getPatients()])
      setTherapist(boot.therapist)
      setWeeklyConfig(boot.weeklyConfig || {})
      setPatients(allPatients)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

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
    setGenerating(true)
    try {
      const generated = await api.generateSchedule(weekStart)
      setSchedule(generated)
      setTab('schedule')
    } catch (e) {
      console.error(e)
    } finally {
      setGenerating(false)
    }
  }

  const activeCount = patients.filter((p) => p.active).length

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-inner">
          <div style={{ fontSize: 56, marginBottom: 16 }}>🩺</div>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--green)' }}>Kiné Tournée</div>
          <div className="small muted" style={{ marginTop: 4 }}>Chargement…</div>
          <div style={{ marginTop: 24, display: 'grid', gap: 12, width: 280 }}>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={3} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Overlay mobile */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''} no-print`}>
        <div className="sidebar-brand">
          <span className="sidebar-logo">🩺</span>
          <div>
            <div className="sidebar-title">Kiné Tournée</div>
            <div className="sidebar-sub">{therapist?.full_name || therapist?.name || ''}</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${tab === n.id ? 'nav-item--active' : ''}`}
              onClick={() => { setTab(n.id); setSidebarOpen(false) }}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.id === 'patients' && activeCount > 0 && (
                <span className="nav-badge">{activeCount}</span>
              )}
              {n.id === 'schedule' && schedule?.week_stats && (
                <span className="nav-badge nav-badge--green">{schedule.week_stats.total_visits}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="small muted" style={{ marginBottom: 8 }}>Semaine du {weekLabel}</div>
          <button className="nav-item" onClick={() => setDark((d) => !d)}>
            <span className="nav-icon">{dark ? '☀' : '🌙'}</span>
            <span>{dark ? 'Mode clair' : 'Mode sombre'}</span>
          </button>
        </div>
      </aside>

      {/* Contenu principal */}
      <main className="app-main">
        {/* Header mobile */}
        <div className="mobile-header no-print">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
          <span className="sidebar-title">🩺 Kiné Tournée</span>
          <button className="mobile-menu-btn" onClick={() => setDark((d) => !d)}>{dark ? '☀' : '🌙'}</button>
        </div>

        <div className="main-content">
          {tab === 'dashboard' && (
            <DashboardPage patients={patients} schedule={schedule} weekStart={weekStart} />
          )}
          {tab === 'schedule' && (
            <SchedulePage
              schedule={schedule} setSchedule={setSchedule}
              weekStart={weekStart} setWeekStart={setWeekStart}
              onGenerate={handleGenerate} therapist={therapist}
              weeklyConfig={weeklyConfig} generating={generating}
            />
          )}
          {tab === 'navigation' && (
            <NavigationPage
              schedule={schedule}
              weeklyConfig={weeklyConfig}
              therapist={therapist}
            />
          )}
          {tab === 'history' && <HistoryPage />}
          {tab === 'patients' && (
            <PatientsPage patients={patients} setPatients={setPatients} />
          )}
          {tab === 'settings' && (
            <SettingsPage therapist={therapist} setTherapist={setTherapist}
              weeklyConfig={weeklyConfig} setWeeklyConfig={setWeeklyConfig} />
          )}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
