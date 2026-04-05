import { useMemo } from 'react'
import { Skeleton } from '../components/Skeleton'

const PATIENT_COLORS = ['#184f3b','#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#9333ea']

function getColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return PATIENT_COLORS[Math.abs(h) % PATIENT_COLORS.length]
}

function Avatar({ name, size = 36 }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const color = getColor(name)
  return (
    <div className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}>
      {initials}
    </div>
  )
}

function KpiCard({ icon, label, value, sub, color = 'var(--green)' }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ background: color + '18', color }}>{icon}</div>
      <div>
        <div className="kpi-value" style={{ color }}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

export default function DashboardPage({ patients, schedule, weekStart }) {
  const activePatients = patients.filter((p) => p.active)
  const inactivePatients = patients.filter((p) => !p.active)

  const weekStats = schedule?.week_stats
  const days = schedule?.days ?? []
  const activeDays = days.filter((d) => d.visits.length > 0)

  // Alertes ordonnances
  const prescriptionAlerts = useMemo(() =>
    activePatients.filter((p) => {
      if (!p.prescription_sessions_total) return false
      const remaining = p.prescription_sessions_total - (p.prescription_sessions_done ?? 0)
      return remaining <= 3
    }), [activePatients])

  // Patients non planifiés cette semaine
  const plannedIds = new Set(days.flatMap((d) => d.visits.map((v) => v.patient_id)))
  const unplanned = activePatients.filter((p) => !plannedIds.has(p.id))

  const avgKmPerDay = activeDays.length
    ? Math.round(((weekStats?.total_km ?? 0) / activeDays.length) * 10) / 10
    : 0

  const travelPct = weekStats
    ? Math.round((weekStats.total_travel_min / Math.max(1, weekStats.total_travel_min + weekStats.total_session_min)) * 100)
    : 0

  return (
    <div className="grid" style={{ gap: 20 }}>
      <h2 style={{ margin: 0 }}>Tableau de bord</h2>

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard icon="👤" label="Patients actifs" value={activePatients.length}
          sub={inactivePatients.length ? `${inactivePatients.length} inactif(s)` : 'Tous actifs'} />
        <KpiCard icon="📋" label="Visites planifiées" value={weekStats?.total_visits ?? '—'}
          sub={`Semaine du ${weekStart}`} color="#2563eb" />
        <KpiCard icon="🛣" label="Kilomètres / semaine" value={weekStats ? `${weekStats.total_km} km` : '—'}
          sub={avgKmPerDay ? `~${avgKmPerDay} km/jour` : ''} color="#7c3aed" />
        <KpiCard icon="⏱" label="Temps de trajet" value={weekStats ? `${travelPct}%` : '—'}
          sub={weekStats ? `${weekStats.total_travel_min} min de déplacement` : ''} color="#ea580c" />
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {/* Alertes */}
        <div className="card grid">
          <h3 style={{ margin: 0 }}>⚠ Alertes</h3>
          {prescriptionAlerts.length === 0 && unplanned.length === 0 && (
            <div className="empty-state small">Aucune alerte — tout est en ordre ✓</div>
          )}
          {prescriptionAlerts.map((p) => {
            const remaining = p.prescription_sessions_total - (p.prescription_sessions_done ?? 0)
            return (
              <div key={p.id} className="alert-row alert-row--orange">
                <Avatar name={p.full_name} size={32} />
                <div>
                  <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                  <div className="small muted">
                    {remaining <= 0
                      ? 'Ordonnance épuisée — renouvellement nécessaire'
                      : `Plus que ${remaining} séance(s) — renouveler l'ordonnance`}
                  </div>
                </div>
              </div>
            )
          })}
          {unplanned.length > 0 && schedule && (
            <>
              <div className="small muted" style={{ marginTop: 4 }}>Non planifiés cette semaine :</div>
              {unplanned.map((p) => (
                <div key={p.id} className="alert-row alert-row--blue">
                  <Avatar name={p.full_name} size={32} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                    <div className="small muted">{p.sessions_per_week} séance(s)/semaine attendues</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Patients récents */}
        <div className="card grid">
          <h3 style={{ margin: 0 }}>Patients actifs</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activePatients.slice(0, 8).map((p) => {
              const planned = plannedIds.has(p.id)
              const remaining = p.prescription_sessions_total
                ? p.prescription_sessions_total - (p.prescription_sessions_done ?? 0)
                : null
              return (
                <div key={p.id} className="dash-patient-row">
                  <Avatar name={p.full_name} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.full_name}</div>
                    <div className="small muted">{p.address}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    {schedule && (
                      <span className={`badge ${planned ? 'badge-green' : 'badge-inactive'}`}>
                        {planned ? '✓ Planifié' : 'Non planifié'}
                      </span>
                    )}
                    {remaining !== null && remaining <= 3 && (
                      <span className={`badge ${remaining <= 0 ? 'badge-red' : 'badge-orange'}`}>
                        {remaining <= 0 ? 'Ordonnance épuisée' : `${remaining} séances restantes`}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {activePatients.length === 0 && (
              <div className="empty-state">Aucun patient actif</div>
            )}
          </div>
        </div>
      </div>

      {/* Résumé semaine par jour */}
      {activeDays.length > 0 && (
        <div className="card grid">
          <h3 style={{ margin: 0 }}>Semaine du {weekStart}</h3>
          <div className="week-summary-grid">
            {activeDays.map((day) => (
              <div key={day.date} className="week-day-pill">
                <div className="week-day-name">
                  {new Date(day.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short' })}
                </div>
                <div className="week-day-visits">{day.visits.length}</div>
                <div className="small muted">{day.stats?.total_km ?? '—'} km</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
