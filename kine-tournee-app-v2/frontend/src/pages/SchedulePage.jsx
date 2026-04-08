import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { getCurrentPosition, launchFullRoute, navigateTo, navigateWaze } from '../lib/gps'
import { useToast } from '../components/Toast'
import NotifyModal from '../components/NotifyModal'

const DAY_LABELS_FR = {
  monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi',
  thursday: 'Jeudi', friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche',
}

const PATIENT_COLORS = ['#184f3b','#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#9333ea']
function getColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return PATIENT_COLORS[Math.abs(h) % PATIENT_COLORS.length]
}
function Avatar({ name, size = 32 }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return <div className="avatar" style={{ width: size, height: size, background: getColor(name), fontSize: size * 0.38 }}>{initials}</div>
}

function parseMin(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ── Carte Leaflet ─────────────────────────────────────────────────────────────
function DayMap({ day, startLat, startLng, endLat, endLng, userPosition }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    const L = window.L
    if (!L || !mapRef.current) return
    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null }

    const map = L.map(mapRef.current)
    mapInstanceRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map)

    const points = []
    const mkIcon = (html) => L.divIcon({ className: '', html, iconSize: [32, 32], iconAnchor: [16, 16] })

    if (startLat && startLng) {
      L.marker([startLat, startLng], { icon: mkIcon('<div class="map-marker map-marker--start">D</div>') }).addTo(map).bindPopup('Départ')
      points.push([startLat, startLng])
    }
    day.visits.forEach((v, i) => {
      if (!v.lat || !v.lng) return
      const color = getColor(v.patient_name)
      L.marker([v.lat, v.lng], { icon: mkIcon(`<div class="map-marker map-marker--visit" style="background:${color}">${i+1}</div>`) })
        .addTo(map).bindPopup(`<strong>${v.patient_name}</strong><br>${v.start_time}–${v.end_time}<br><small>${v.address}</small>`)
      points.push([v.lat, v.lng])
    })
    if (endLat && endLng) {
      L.marker([endLat, endLng], { icon: mkIcon('<div class="map-marker map-marker--end">A</div>') }).addTo(map).bindPopup('Arrivée')
      points.push([endLat, endLng])
    }
    if (userPosition) {
      L.marker([userPosition.lat, userPosition.lng], { icon: mkIcon('<div class="map-marker map-marker--me">📍</div>') }).addTo(map).bindPopup('Ma position')
    }
    if (points.length > 1) {
      L.polyline(points, { color: '#184f3b', weight: 3, opacity: 0.75, dashArray: '6,4' }).addTo(map)
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32] })
    } else if (points.length === 1) map.setView(points[0], 14)
    else map.setView([46.6, 2.3], 6)

    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null } }
  }, [day, startLat, startLng, endLat, endLng, userPosition])

  return <div ref={mapRef} className="day-map" />
}

// ── Vue Timeline ──────────────────────────────────────────────────────────────
function TimelineView({ day, completions, onCompletionToggle, dayStart = '08:00', dayEnd = '19:00' }) {
  const startMin = parseMin(dayStart)
  const endMin = parseMin(dayEnd)
  const totalMin = endMin - startMin
  const hours = []
  for (let h = Math.floor(startMin / 60); h <= Math.ceil(endMin / 60); h++) hours.push(h)

  function pct(min) { return Math.max(0, Math.min(100, ((min - startMin) / totalMin) * 100)) }

  return (
    <div className="timeline">
      {/* Lignes horaires */}
      <div className="timeline-hours">
        {hours.map((h) => (
          <div key={h} className="timeline-hour" style={{ top: `${pct(h * 60)}%` }}>
            <span>{String(h).padStart(2, '0')}:00</span>
          </div>
        ))}
      </div>
      {/* Visites */}
      <div className="timeline-track">
        {day.visits.map((v, i) => {
          const vs = parseMin(v.start_time)
          const ve = parseMin(v.end_time)
          const top = pct(vs)
          const height = Math.max(2, pct(ve) - top)
          const key = `${v.patient_id}|${day.date}`
          const isDone = completions[key]?.done ?? v.done
          const color = getColor(v.patient_name)
          return (
            <div
              key={`${v.patient_id}-${v.start_time}`}
              className={`timeline-visit ${isDone ? 'timeline-visit--done' : ''}`}
              style={{ top: `${top}%`, height: `${height}%`, borderLeft: `4px solid ${color}`, background: color + '18' }}
              title={`${v.patient_name} — ${v.start_time} à ${v.end_time}`}
            >
              <div className="timeline-visit-content">
                <div className="timeline-visit-time">{v.start_time}</div>
                <div className="timeline-visit-name">{v.patient_name}</div>
                <div className="timeline-visit-dur">{v.session_duration_min} min</div>
              </div>
              <input
                type="checkbox"
                checked={isDone}
                className="visit-check"
                onChange={() => onCompletionToggle(v.patient_id, day.date, !isDone, completions[key]?.notes)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Vue tableau ───────────────────────────────────────────────────────────────
function TableView({ day, completions, onCompletionToggle, onVisitsReorder }) {
  const [dragFrom, setDragFrom] = useState(null)
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th style={{ width: 32 }}>✓</th>
            <th>Patient</th>
            <th>Horaire</th>
            <th>Trajet</th>
            <th>Durée</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {day.visits.map((visit, i) => {
            const key = `${visit.patient_id}|${day.date}`
            const isDone = completions[key]?.done ?? visit.done
            return (
              <tr
                key={`${visit.patient_id}-${visit.start_time}`}
                className={`visit-row ${isDone ? 'visit-row--done' : ''} ${visit.is_fixed ? 'visit-row--fixed' : ''}`}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom === null || dragFrom === i) return
                  const nv = [...day.visits]
                  const [m] = nv.splice(dragFrom, 1)
                  nv.splice(i, 0, m)
                  onVisitsReorder(day.day, nv)
                  setDragFrom(null)
                }}
              >
                <td className="drag-handle">⠿</td>
                <td>
                  <input type="checkbox" checked={isDone} className="visit-check"
                    onChange={() => onCompletionToggle(visit.patient_id, day.date, !isDone, completions[key]?.notes)} />
                </td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar name={visit.patient_name} size={28} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{visit.patient_name}</div>
                      <div className="small muted">{visit.address}</div>
                    </div>
                  </div>
                </td>
                <td><span style={{ fontWeight: 600 }}>{visit.start_time}</span> → {visit.end_time}</td>
                <td>
                  <div>{visit.estimated_travel_min} min</div>
                  {visit.estimated_km !== undefined && <div className="small muted">{visit.estimated_km} km</div>}
                </td>
                <td>{visit.session_duration_min} min</td>
                <td>
                  {visit.lat && visit.lng && (
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn-gps" onClick={() => navigateTo(visit.lat, visit.lng)} title="Google Maps">🗺</button>
                      <button className="btn-gps" onClick={() => navigateWaze(visit.lat, visit.lng)} title="Waze">🚗</button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Stats journée ─────────────────────────────────────────────────────────────
function DayStats({ stats }) {
  if (!stats) return null
  const total = (stats.total_travel_min || 0) + (stats.total_session_min || 0)
  const travelPct = total ? Math.round((stats.total_travel_min / total) * 100) : 0
  return (
    <div className="day-stats">
      <div className="stat-pill"><span className="stat-value">{stats.total_visits}</span><span className="stat-label">visites</span></div>
      <div className="stat-pill"><span className="stat-value">{stats.total_km ?? '–'} km</span><span className="stat-label">trajet</span></div>
      <div className="stat-pill"><span className="stat-value">{stats.total_session_min} min</span><span className="stat-label">soins</span></div>
      <div className="stat-pill"><span className="stat-value">{stats.total_travel_min} min</span><span className="stat-label">déplacement</span></div>
      <div className="stat-pill"><span className="stat-value">{travelPct}%</span><span className="stat-label">temps trajet</span></div>
    </div>
  )
}

// ── Notifications push système ────────────────────────────────────────────────
function notifSupported() { return 'Notification' in window }
function notifGranted() { return notifSupported() && Notification.permission === 'granted' }

async function requestNotifPermission() {
  if (!notifSupported()) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// Envoyer une notification système (remplace la précédente via tag unique)
function sendDelayNotif(delayMin) {
  if (!notifGranted()) return
  const isRetard = delayMin > 0
  new Notification(isRetard ? '⚠ Retard tournée' : '✅ Avance tournée', {
    body: isRetard
      ? `Retard estimé : ${delayMin} min — prévenez vos prochains patients.`
      : `Avance estimée : ${Math.abs(delayMin)} min — vous pouvez prévenir la suite.`,
    tag: 'tournee-timing', // remplace la notif précédente, pas de spam
    silent: false,
  })
}

// ── Calcul avance/retard par rapport au planning ───────────────────────────────
// Retourne le delta en minutes (>0 = retard, <0 = avance) ou null si non applicable
function computeDelayMin(visits, completions, date) {
  const doneVisits = visits.filter((v) => completions[`${v.patient_id}|${date}`]?.done ?? v.done)
  // N'afficher que si en cours de journée (au moins 1 validé, pas tous)
  if (!doneVisits.length || doneVisits.length === visits.length) return null
  const lastDone = doneVisits[doneVisits.length - 1]
  const plannedEndMin = parseMin(lastDone.end_time)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return nowMin - plannedEndMin
}

// ── Bloc journée ──────────────────────────────────────────────────────────────
function DayBlock({ day, therapist, weeklyConfig, completions, onCompletionToggle, onVisitsReorder, viewMode, userPosition }) {
  const [showMap, setShowMap] = useState(false)
  const dayConfig = weeklyConfig?.[day.day] || {}
  const startLat = dayConfig.start_lat ?? therapist?.default_start_lat
  const startLng = dayConfig.start_lng ?? therapist?.default_start_lng
  const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
  const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
  const dayLabel = `${DAY_LABELS_FR[day.day] || day.day} ${new Date(day.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`
  const doneCount = day.visits.filter((v) => completions[`${v.patient_id}|${day.date}`]?.done ?? v.done).length
  const delayMin = computeDelayMin(day.visits, completions, day.date)

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 16 }}>{dayLabel}</strong>
            {day.visits.length > 0 && (
              <span className={`badge ${doneCount === day.visits.length ? 'badge-green' : 'badge-inactive'}`}>
                {doneCount}/{day.visits.length}
              </span>
            )}
          </div>
          {day.start_address && <div className="small muted">Départ : {day.start_address}</div>}
        </div>
        {day.visits.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn-gps" style={{ padding: '6px 10px' }}
              onClick={() => launchFullRoute(day.visits, startLat, startLng, endLat, endLng)}
              title="Lancer toute la tournée dans Google Maps">
              🚀 Lancer la tournée
            </button>
            <button className="secondary small-btn" onClick={() => setShowMap((v) => !v)}>
              {showMap ? '🗺 Masquer carte' : '🗺 Carte'}
            </button>
          </div>
        )}
      </div>

      {day.visits.length > 0 && <DayStats stats={day.stats} />}

      {/* Bannière avance / retard */}
      {delayMin !== null && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, fontWeight: 600, fontSize: 13,
          background: delayMin > 5 ? '#fef3c7' : '#dcfce7',
          color: delayMin > 5 ? '#92400e' : '#166534',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {delayMin > 5
            ? `⚠ Retard estimé : ${delayMin} min — pensez à prévenir la suite de la tournée`
            : delayMin < -3
              ? `✅ Avance estimée : ${Math.abs(delayMin)} min — vous pouvez prévenir les prochains patients`
              : '✅ Dans les temps'}
        </div>
      )}

      {showMap && window.L && (
        <DayMap day={day} startLat={startLat} startLng={startLng} endLat={endLat} endLng={endLng} userPosition={userPosition} />
      )}

      {day.visits.length === 0 && <div className="empty-state">Aucune visite planifiée.</div>}

      {day.visits.length > 0 && (
        viewMode === 'timeline'
          ? <TimelineView day={day} completions={completions} onCompletionToggle={onCompletionToggle}
              dayStart={dayConfig.work_start || '08:00'} dayEnd={dayConfig.work_end || '19:00'} />
          : <TableView day={day} completions={completions} onCompletionToggle={onCompletionToggle} onVisitsReorder={onVisitsReorder} />
      )}

      {day.visits.length > 0 && day.estimated_return_travel_min !== undefined && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Retour : ~{day.estimated_return_travel_min} min{day.estimated_return_km ? ` / ${day.estimated_return_km} km` : ''} → {day.end_address || 'domicile'}
          {endLat && endLng && (
            <button className="btn-gps" style={{ marginLeft: 8 }} onClick={() => navigateTo(endLat, endLng, 'Domicile')}>🗺 Rentrer</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stats semaine ─────────────────────────────────────────────────────────────
function WeekStats({ weekStats, routingSource }) {
  if (!weekStats) return null
  const { total_visits, total_km, total_travel_min, total_session_min } = weekStats
  const totalMin = total_travel_min + total_session_min
  const travelPct = totalMin ? Math.round((total_travel_min / totalMin) * 100) : 0
  return (
    <div className="card week-stats">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Résumé de la semaine</h3>
        <span className={`badge ${routingSource === 'osrm' ? 'badge-green' : 'badge-orange'}`}>
          {routingSource === 'osrm' ? '🛣 Temps réels OSRM' : '📐 Estimation'}
        </span>
      </div>
      <div className="week-stats-grid">
        {[
          { v: total_visits, l: 'visites' },
          { v: `${total_km} km`, l: 'parcourus' },
          { v: `${Math.floor(total_session_min/60)}h${String(total_session_min%60).padStart(2,'0')}`, l: 'de soins' },
          { v: `${Math.floor(total_travel_min/60)}h${String(total_travel_min%60).padStart(2,'0')}`, l: 'de trajet' },
          { v: `${travelPct}%`, l: 'temps trajet' },
        ].map((s) => (
          <div key={s.l} className="stat-card"><div className="stat-card-value">{s.v}</div><div className="stat-card-label">{s.l}</div></div>
        ))}
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function SchedulePage({ schedule, setSchedule, weekStart, setWeekStart, onGenerate, therapist, weeklyConfig, generating, patients }) {
  const toast = useToast()
  const [completions, setCompletions] = useState({})
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'timeline'
  const [userPosition, setUserPosition] = useState(null)
  const [showNotify, setShowNotify] = useState(false)
  const [notifEnabled, setNotifEnabled] = useState(notifGranted)

  useEffect(() => {
    if (!schedule?.week_start) return
    api.getCompletions(schedule.week_start)
      .then((data) => {
        const map = {}
        data.forEach((c) => { map[`${c.patient_id}|${c.visit_date}`] = c })
        setCompletions(map)
      }).catch(() => {})
  }, [schedule?.week_start, schedule?.generated_at])

  async function handleCompletionToggle(patientId, visitDate, done) {
    const key = `${patientId}|${visitDate}`
    try {
      const updated = await api.upsertCompletion({ patient_id: patientId, visit_date: visitDate, done })
      const newCompletions = { ...completions, [key]: updated }
      setCompletions(newCompletions)
      if (done) toast.success('Séance validée ✓')
      else toast.info('Séance remise en attente')

      // Notification push système
      const day = schedule?.days?.find((d) => d.date === visitDate)
      if (day) {
        const delayMin = computeDelayMin(day.visits, newCompletions, visitDate)
        if (delayMin !== null && Math.abs(delayMin) >= 5) sendDelayNotif(delayMin)
      }
    } catch { toast.error('Erreur lors de la mise à jour') }
  }

  function handleVisitsReorder(dayKey, newVisits) {
    setSchedule((prev) => ({
      ...prev,
      days: prev.days.map((d) => d.day === dayKey ? { ...d, visits: newVisits } : d),
    }))
  }

  async function handleSaveManual() {
    if (!schedule) return
    setSaving(true)
    try {
      await api.saveSchedule(schedule.week_start, schedule)
      toast.success('Planning sauvegardé')
    } catch { toast.error('Erreur lors de la sauvegarde') } finally { setSaving(false) }
  }

  async function handleLocate() {
    try {
      const pos = await getCurrentPosition()
      setUserPosition(pos)
      toast.success('Position localisée ✓')
    } catch { toast.error('Impossible de récupérer votre position') }
  }

  async function handleCopyWeek() {
    if (!schedule) return
    const nextMonday = new Date(new Date(weekStart + 'T00:00:00').getTime() + 7 * 86400000).toISOString().slice(0, 10)
    try {
      const generated = await api.generateSchedule(nextMonday)
      setSchedule(generated)
      setWeekStart(nextMonday)
      toast.success('Tournée générée pour la semaine suivante')
    } catch (e) { toast.error(e.message) }
  }

  const activeDays = schedule?.days?.filter((d) => d.visits.length > 0) || []
  const totalDone = activeDays.reduce((acc, d) => acc + d.visits.filter((v) => completions[`${v.patient_id}|${d.date}`]?.done ?? v.done).length, 0)
  const totalVisits = activeDays.reduce((acc, d) => acc + d.visits.length, 0)

  return (
    <div className="grid" id="schedule-page">
      {showNotify && (
        <NotifyModal
          schedule={schedule}
          patients={patients || []}
          therapist={therapist}
          onClose={() => setShowNotify(false)}
        />
      )}
      {/* Barre d'outils */}
      <div className="card no-print toolbar">
        <div className="row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <span className="small" style={{ fontWeight: 600 }}>Semaine du lundi</span>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={onGenerate} disabled={generating}>
            {generating ? '⏳ Génération OSRM…' : '⚡ Générer'}
          </button>
          {schedule && (
            <>
              <button className="secondary small-btn" onClick={handleSaveManual} disabled={saving}>{saving ? '…' : '💾 Sauvegarder'}</button>
              <button className="secondary small-btn" onClick={handleCopyWeek} title="Générer la semaine suivante">⏭ Semaine +1</button>
              <button className="secondary small-btn" onClick={handleLocate} title="Ma position">📍 Me localiser</button>
              {notifSupported() && (
                <button
                  className="secondary small-btn"
                  title={notifEnabled ? 'Notifications push activées' : 'Activer les notifications push retard/avance'}
                  onClick={async () => {
                    const granted = await requestNotifPermission()
                    setNotifEnabled(granted)
                    if (granted) toast.success('Notifications push activées ✓')
                    else toast.warning('Notifications refusées par le navigateur')
                  }}
                >
                  {notifEnabled ? '🔔' : '🔕 Notifs'}
                </button>
              )}
              <button className="btn-notify" onClick={() => setShowNotify(true)} title="Envoyer les horaires aux patients">📱 Notifier</button>
              <div className="view-toggle">
                <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>≡ Liste</button>
                <button className={viewMode === 'timeline' ? 'active' : ''} onClick={() => setViewMode('timeline')}>⏱ Timeline</button>
              </div>
              <button className="secondary small-btn" onClick={() => window.print()}>🖨</button>
            </>
          )}
        </div>
      </div>

      {!schedule && (
        <div className="card empty-hero">
          <div className="empty-hero-icon">📋</div>
          <div className="empty-hero-title">Aucune tournée générée</div>
          <div className="empty-hero-sub">Cliquez sur « Générer » pour optimiser votre semaine avec les temps de trajet réels.</div>
          <button className="primary" onClick={onGenerate} disabled={generating} style={{ marginTop: 12 }}>
            {generating ? '⏳ Génération en cours…' : '⚡ Générer la tournée'}
          </button>
        </div>
      )}

      {schedule && (
        <>
          {totalVisits > 0 && (
            <div className="card no-print" style={{ padding: '12px 16px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small">Progression : <strong>{totalDone}/{totalVisits}</strong> séances effectuées</span>
                <span className="small muted">{Math.round((totalDone / totalVisits) * 100)}%</span>
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.round((totalDone / totalVisits) * 100)}%` }} /></div>
            </div>
          )}
          <WeekStats weekStats={schedule.week_stats} routingSource={schedule.routing_source} />
          {schedule.days.map((day) => (
            <DayBlock key={day.date} day={day} therapist={therapist} weeklyConfig={weeklyConfig}
              completions={completions} onCompletionToggle={handleCompletionToggle}
              onVisitsReorder={handleVisitsReorder} viewMode={viewMode} userPosition={userPosition} />
          ))}
          <div className="print-only print-header">
            <h1>Tournée — Semaine du {weekStart}</h1>
            {schedule.week_stats && <p>{schedule.week_stats.total_visits} visites · {schedule.week_stats.total_km} km · {new Date(schedule.generated_at).toLocaleDateString('fr-FR')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
