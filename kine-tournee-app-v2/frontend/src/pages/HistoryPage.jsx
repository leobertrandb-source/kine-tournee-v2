import { useEffect, useState } from 'react'
import { api } from '../lib/api'

function WeekDetail({ entry, onClose }) {
  const schedule = entry.payload
  const days = schedule?.days || []
  const totalVisits = days.reduce((s, d) => s + (d.visits?.length || 0), 0)
  const totalKm = schedule?.week_stats?.total_km ?? days.reduce((s, d) => s + (d.total_km || 0), 0)

  return (
    <div className="history-detail">
      <div className="history-detail-header">
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            Semaine du {new Date(entry.week_start + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="small muted">{totalVisits} visites · {totalKm?.toFixed?.(1) ?? '?'} km</div>
        </div>
        <button className="secondary small-btn" onClick={onClose}>✕ Fermer</button>
      </div>
      <div className="history-days-grid">
        {days.filter((d) => d.visits?.length > 0).map((d) => (
          <div key={d.day} className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>
              {new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}
              <span className="small muted" style={{ marginLeft: 8 }}>{d.visits.length} visites · {d.total_km?.toFixed?.(1) ?? '?'} km</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {d.visits.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>{i+1}.</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{v.patient_name}</span>
                  <span className="small muted">{v.start_time} · {v.session_duration_min}min</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HistoryPage() {
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    api.getScheduleHistory()
      .then(setWeeks)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="small muted" style={{ padding: 24 }}>Chargement…</div>

  if (selected) return <WeekDetail entry={selected} onClose={() => setSelected(null)} />

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Historique</h1>
        <div className="small muted">Toutes les tournées générées</div>
      </div>

      {weeks.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          Aucune tournée dans l'historique
        </div>
      )}

      <div className="history-list">
        {weeks.map((entry) => {
          const days = entry.payload?.days || []
          const totalVisits = days.reduce((s, d) => s + (d.visits?.length || 0), 0)
          const totalKm = entry.payload?.week_stats?.total_km ?? days.reduce((s, d) => s + (d.total_km || 0), 0)
          const activeDays = days.filter((d) => d.visits?.length > 0).length
          const weekLabel = new Date(entry.week_start + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
          const isCurrentWeek = entry.week_start === new Date(getMonday()).toISOString().slice(0, 10)

          return (
            <button key={entry.id} className="history-week-row" onClick={() => setSelected(entry)}>
              <div className="history-week-date">
                <div style={{ fontWeight: 700 }}>Semaine du {weekLabel}</div>
                {isCurrentWeek && <span className="badge badge-green badge-xs">Semaine en cours</span>}
              </div>
              <div className="history-week-stats">
                <div className="history-stat">
                  <span className="history-stat-val">{totalVisits}</span>
                  <span className="history-stat-label">visites</span>
                </div>
                <div className="history-stat">
                  <span className="history-stat-val">{activeDays}</span>
                  <span className="history-stat-label">jours</span>
                </div>
                <div className="history-stat">
                  <span className="history-stat-val">{totalKm?.toFixed?.(0) ?? '?'}</span>
                  <span className="history-stat-label">km</span>
                </div>
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getMonday(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}
