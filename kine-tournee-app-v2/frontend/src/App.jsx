import { useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import { supabase } from './lib/supabase'
import PatientsPage from './pages/PatientsPage'
import SettingsPage from './pages/SettingsPage'
import SchedulePage from './pages/SchedulePage'
import DashboardPage from './pages/DashboardPage'
import NavigationPage from './pages/NavigationPage'
import HistoryPage from './pages/HistoryPage'
import LoginPage from './pages/LoginPage'
import { ToastProvider, useToast } from './components/Toast'
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
  const toast = useToast()
  const [session, setSession] = useState(undefined) // undefined = chargement, null = non connecté
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

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null)
  }

  // ── Theme ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  // ── Data loading (seulement si connecté) ────────────────────────────────────
  async function loadAll() {
    try {
      const [boot, allPatients] = await Promise.all([api.bootstrap(), api.getPatients()])
      setTherapist(boot.therapist)
      setWeeklyConfig(boot.weeklyConfig || {})
      setPatients(allPatients)
    } catch (e) {
      console.error(e)
      toast.error('Impossible de joindre le serveur')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) loadAll()
    else if (session === null) setLoading(false)
  }, [session])

  useEffect(() => {
    if (loading || !session) return
    api.getSchedule(weekStart).then((s) => {
      if (s?.days?.length) setSchedule(s)
      else setSchedule(null)
    }).catch(() => {})
  }, [loading, weekStart, session])

  const weekLabel = useMemo(() => {
    const d = new Date(`${weekStart}T00:00:00`)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  }, [weekStart])

  async function handleGenerate() {
    setGenerating(true)
    toast.info('Génération en cours…')
    try {
      const generated = await api.generateSchedule(weekStart)
      setSchedule(generated)
      setTab('schedule')
      toast.success('Tournée générée ✓')
    } catch (e) {
      console.error(e)
      toast.error(e.message === 'Failed to fetch'
        ? 'Serveur indisponible — réessayez dans 30 secondes'
        : `Erreur : ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const activeCount = patients.filter((p) => p.active).length

  // ── Écran de chargement initial (auth + données) ────────────────────────────
  if (session === undefined || (session && loading)) {
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

  // ── Page de connexion ───────────────────────────────────────────────────────
  if (!session) {
    return <LoginPage onLogin={setSession} />
  }

  // ── Application principale ──────────────────────────────────────────────────
  return (
    <div className="app-layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''} no-print`}>
        <div className="sidebar-brand">
          <span className="sidebar-logo">🩺</span>
          <div>
            <div className="sidebar-title">Kiné Tournée</div>
            <div className="sidebar-sub">{therapist?.full_name || therapist?.name || session?.user?.email || ''}</div>
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
          <button className="nav-item" style={{ color: 'var(--red)', marginTop: 2 }} onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      <main className="app-main">
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
              patients={patients}
            />
          )}
          {tab === 'navigation' && (
            <NavigationPage
              schedule={schedule}
              weeklyConfig={weeklyConfig}
              therapist={therapist}
              onGoToPlanning={() => setTab('schedule')}
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
