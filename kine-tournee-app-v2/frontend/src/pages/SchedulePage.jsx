import { useEffect, useMemo, useRef, useState } from 'react'
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

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Recalcule les horaires après un réordonnancement DnD.
 * Les estimated_travel_min sont conservés tels quels (approximation).
 */
function recalcTimes(visits, workStart, sessionBuffer = 5) {
  let current = parseMin(workStart)
  return visits.map((v) => {
    const travel = v.estimated_travel_min ?? 10
    const start  = current + travel
    const end    = start + (v.session_duration_min ?? 30)
    current = end + sessionBuffer
    return { ...v, start_time: fmtMin(start), end_time: fmtMin(end) }
  })
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
  const [dragOver, setDragOver] = useState(null)
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
                className={`visit-row ${isDone ? 'visit-row--done' : ''} ${visit.is_fixed ? 'visit-row--fixed' : ''} ${dragOver === i && dragFrom !== i ? 'visit-row--drag-over' : ''} ${dragFrom === i ? 'visit-row--dragging' : ''}`}
                draggable
                onDragStart={() => { setDragFrom(i); setDragOver(null) }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                onDrop={() => {
                  if (dragFrom === null || dragFrom === i) return
                  const nv = [...day.visits]
                  const [m] = nv.splice(dragFrom, 1)
                  nv.splice(i, 0, m)
                  onVisitsReorder(day.day, nv)
                  setDragFrom(null)
                  setDragOver(null)
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

// ── Utilitaires numéro WhatsApp ───────────────────────────────────────────────
function toWhatsAppNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('33')) return digits
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1)
  return digits.length >= 9 ? digits : null
}

// ── Modal retard / avance → notifier les patients restants ────────────────────
function DelayNotifyModal({ day, completions, delayMin, patients, therapist, onClose }) {
  const toast = useToast()
  const isRetard = delayMin > 0
  const absDelay = Math.abs(delayMin)

  // Dernière visite validée → les patients restants sont ceux qui viennent après
  const lastDoneIdx = day.visits.reduce((acc, v, i) => {
    if (completions[`${v.patient_id}|${day.date}`]?.done ?? v.done) return i
    return acc
  }, -1)

  const remaining = day.visits
    .slice(lastDoneIdx + 1)
    .filter((v) => !(completions[`${v.patient_id}|${day.date}`]?.done ?? v.done))

  function buildMsg(visit) {
    const p = patients.find((pt) => pt.id === visit.patient_id)
    const firstName = p?.sms_first_name || p?.full_name?.split(' ')[0] || 'Bonjour'
    const newTime = fmtMin(Math.max(0, parseMin(visit.start_time) + delayMin))
    if (isRetard) {
      return `Bonjour ${firstName}, je suis actuellement en retard de ${absDelay} minute${absDelay > 1 ? 's' : ''}. Je passerai vers ${newTime} environ. Merci de votre compréhension.\n\n${therapist?.full_name || 'Votre kinésithérapeute'}`
    }
    return `Bonjour ${firstName}, je suis en avance de ${absDelay} minute${absDelay > 1 ? 's' : ''} aujourd'hui. Je pourrais passer vers ${newTime}. Êtes-vous disponible un peu plus tôt ?\n\n${therapist?.full_name || 'Votre kinésithérapeute'}`
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              {isRetard ? `⚠ Retard ${absDelay} min — Prévenir les patients suivants` : `✅ Avance ${absDelay} min — Prévenir les patients suivants`}
            </div>
            <div className="small muted">{remaining.length} patient{remaining.length > 1 ? 's' : ''} restant{remaining.length > 1 ? 's' : ''}</div>
          </div>
          <button className="secondary small-btn" onClick={onClose}>✕</button>
        </div>
        <div className="notif-list">
          {remaining.length === 0 && <div className="empty-state">Aucun patient restant à prévenir.</div>}
          {remaining.map((visit) => {
            const p = patients.find((pt) => pt.id === visit.patient_id)
            const msg = buildMsg(visit)
            const waNum = toWhatsAppNumber(p?.phone)
            const waUrl = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}` : null
            const newTime = fmtMin(Math.max(0, parseMin(visit.start_time) + delayMin))
            return (
              <div key={visit.patient_id} className="notif-row">
                <div className="notif-row-header">
                  <div>
                    <div style={{ fontWeight: 700 }}>{visit.patient_name}</div>
                    <div className="small muted">
                      Prévu <strong>{visit.start_time}</strong> → estimé <strong>{newTime}</strong>
                    </div>
                  </div>
                  <div className="notif-row-btns">
                    {waUrl
                      ? <a className="notif-btn notif-btn--wa" href={waUrl} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
                      : <span className="small muted" title="Numéro manquant">Pas de n°</span>
                    }
                    <button className="notif-btn notif-btn--copy" onClick={async () => {
                      try { await navigator.clipboard.writeText(msg); toast.success('Copié ✓') }
                      catch { toast.error('Impossible de copier') }
                    }}>📋 Copier</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
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
function DayBlock({ day, therapist, weeklyConfig, completions, onCompletionToggle, onVisitsReorder, viewMode, userPosition, patients }) {
  const [showMap, setShowMap] = useState(false)
  const [showDelayNotify, setShowDelayNotify] = useState(false)
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
        <>
          {showDelayNotify && (
            <DelayNotifyModal
              day={day}
              completions={completions}
              delayMin={delayMin}
              patients={patients || []}
              therapist={therapist}
              onClose={() => setShowDelayNotify(false)}
            />
          )}
          <div style={{
            padding: '8px 14px', borderRadius: 6, fontWeight: 600, fontSize: 13,
            background: delayMin > 5 ? '#fef3c7' : '#dcfce7',
            color: delayMin > 5 ? '#92400e' : '#166534',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ flex: 1 }}>
              {delayMin > 5
                ? `⚠ Retard estimé : ${delayMin} min`
                : delayMin < -3
                  ? `✅ Avance estimée : ${Math.abs(delayMin)} min`
                  : '✅ Dans les temps'}
            </span>
            {(delayMin > 5 || delayMin < -3) && (
              <button
                style={{
                  background: delayMin > 5 ? '#92400e' : '#166534',
                  color: '#fff', border: 'none', borderRadius: 6,
                  padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}
                onClick={() => setShowDelayNotify(true)}
              >
                📱 Prévenir les patients suivants
              </button>
            )}
          </div>
        </>
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

// ── Timeline constants + client-side route optimizer ──────────────────────────
const TL_START = 7 * 60    // 07:00
const TL_END   = 20 * 60   // 20:00
const TL_SPAN  = TL_END - TL_START   // 780 min
const TL_H     = 975        // px — 13 h × 75 px/h

function minToTopPx(min) { return ((min - TL_START) / TL_SPAN) * TL_H }
function durToHPx(dur)   { return Math.max(22, (dur / TL_SPAN) * TL_H) }
function snapMin(m)       { return Math.round(m / 15) * 15 }

function haversineKm(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180
  const da = (a2 - a1) * r, dо = (o2 - o1) * r
  const a = Math.sin(da / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dо / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function optimizeDayVisits(visits, sLat, sLng, eLat, eLng) {
  const rot = visits.filter((v) => v.lat && v.lng)
  const no  = visits.filter((v) => !v.lat || !v.lng)
  if (rot.length <= 1) return visits
  // Greedy nearest-neighbor
  let rem = [...rot], ord = []
  let cLat = sLat ?? rot[0].lat, cLng = sLng ?? rot[0].lng
  while (rem.length) {
    let bi = 0, bd = Infinity
    rem.forEach((v, i) => { const d = haversineKm(cLat, cLng, v.lat, v.lng); if (d < bd) { bd = d; bi = i } })
    const [nx] = rem.splice(bi, 1); ord.push(nx); cLat = nx.lat; cLng = nx.lng
  }
  // 2-opt
  let imp = true
  while (imp) {
    imp = false
    for (let i = 0; i < ord.length - 1 && !imp; i++) {
      for (let j = i + 2; j < ord.length; j++) {
        const pLat = i > 0 ? ord[i-1].lat : (sLat ?? ord[0].lat)
        const pLng = i > 0 ? ord[i-1].lng : (sLng ?? ord[0].lng)
        const nLat = j < ord.length - 1 ? ord[j+1].lat : (eLat ?? ord[j].lat)
        const nLng = j < ord.length - 1 ? ord[j+1].lng : (eLng ?? ord[j].lng)
        const bef = haversineKm(pLat, pLng, ord[i].lat, ord[i].lng) + haversineKm(ord[j].lat, ord[j].lng, nLat, nLng)
        const aft = haversineKm(pLat, pLng, ord[j].lat, ord[j].lng) + haversineKm(ord[i].lat, ord[i].lng, nLat, nLng)
        if (aft < bef - 0.05) { ord = [...ord.slice(0,i), ...ord.slice(i,j+1).reverse(), ...ord.slice(j+1)]; imp = true; break }
      }
    }
  }
  return [...ord, ...no]
}

// ── Vue semaine drag-and-drop ─────────────────────────────────────────────────
function WeeklyDragView({ schedule, setSchedule, therapist, weeklyConfig, setWeeklyConfig, completions, onCompletionToggle, patients }) {
  const toast = useToast()
  const [dragging, setDragging]       = useState(null)
  const [dropTarget, setDropTarget]   = useState(null)  // { dayKey, insertIdx } cards mode
  const [dropTime, setDropTime]       = useState(null)  // { dayKey, min }       timeline mode
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [viewMode, setViewMode]       = useState('cards') // 'cards' | 'timeline'
  const saveTimerRef = useRef(null)
  const cfgTimerRef  = useRef(null)
  const tlScrollRef  = useRef(null)

  const days          = schedule?.days ?? []
  const activePatients = useMemo(() => (patients ?? []).filter((p) => p.active), [patients])
  const scheduledIds   = useMemo(
    () => new Set(days.flatMap((d) => d.visits.map((v) => v.patient_id))),
    [days]
  )

  function getWorkStart(dayKey) { return weeklyConfig?.[dayKey]?.work_start ?? '08:00' }
  function getWorkEnd(dayKey)   { return weeklyConfig?.[dayKey]?.work_end   ?? '19:00' }
  function getBuffer()          { return therapist?.session_buffer_min ?? 5 }

  function saveDebounced(updated, weekStart) {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => api.saveSchedule(weekStart, updated).catch(() => {}), 1500)
  }

  // Mise à jour heure départ/fin d'un jour — persiste dans weeklyConfig
  function updateDayTime(dayKey, field, value) {
    // Mettre à jour le state local immédiatement
    setWeeklyConfig((prev) => ({
      ...prev,
      [dayKey]: { ...(prev[dayKey] || {}), [field]: value },
    }))
    // Si on change l'heure de départ, recalculer les horaires de ce jour
    if (field === 'work_start') {
      const day = days.find((d) => d.day === dayKey)
      if (day) {
        const calc = recalcTimes(day.visits, value, getBuffer())
        setSchedule((prev) => {
          const updated = { ...prev, days: prev.days.map((d) => d.day === dayKey ? { ...d, visits: calc } : d) }
          saveDebounced(updated, prev.week_start)
          return updated
        })
      }
    }
    // Sauvegarder la config dans Supabase (debounce 800ms)
    clearTimeout(cfgTimerRef.current)
    cfgTimerRef.current = setTimeout(() => {
      api.updateDayConfig(dayKey, { [field]: value }).catch(() => {})
    }, 800)
  }

  function applyOneDay(dayKey, newVisits) {
    const calc = recalcTimes(newVisits, getWorkStart(dayKey), getBuffer())
    setSchedule((prev) => {
      const updated = { ...prev, days: prev.days.map((d) => d.day === dayKey ? { ...d, visits: calc } : d) }
      saveDebounced(updated, prev.week_start)
      return updated
    })
  }

  function applyTwoDays(dkA, visA, dkB, visB) {
    const calcA = recalcTimes(visA, getWorkStart(dkA), getBuffer())
    const calcB = recalcTimes(visB, getWorkStart(dkB), getBuffer())
    setSchedule((prev) => {
      const updated = {
        ...prev,
        days: prev.days.map((d) => {
          if (d.day === dkA) return { ...d, visits: calcA }
          if (d.day === dkB) return { ...d, visits: calcB }
          return d
        }),
      }
      saveDebounced(updated, prev.week_start)
      return updated
    })
  }

  // ── Timeline: applique sans recalcTimes (temps manuels) ──────────────────────
  function applyOneDayDirect(dayKey, newVisits) {
    const sorted = [...newVisits].sort((a, b) => parseMin(a.start_time) - parseMin(b.start_time))
    setSchedule((prev) => {
      const updated = { ...prev, days: prev.days.map((d) => d.day === dayKey ? { ...d, visits: sorted } : d) }
      saveDebounced(updated, prev.week_start)
      return updated
    })
  }
  function applyTwoDaysDirect(dkA, visA, dkB, visB) {
    const sA = [...visA].sort((a, b) => parseMin(a.start_time) - parseMin(b.start_time))
    const sB = [...visB].sort((a, b) => parseMin(a.start_time) - parseMin(b.start_time))
    setSchedule((prev) => {
      const updated = { ...prev, days: prev.days.map((d) => {
        if (d.day === dkA) return { ...d, visits: sA }
        if (d.day === dkB) return { ...d, visits: sB }
        return d
      }) }
      saveDebounced(updated, prev.week_start)
      return updated
    })
  }

  // ── Optimiser l'ordre d'une journée (greedy NN + 2-opt) ───────────────────
  function handleOptimizeDay(dayKey) {
    const day = days.find((d) => d.day === dayKey)
    if (!day || day.visits.length < 2) return
    const cfg = weeklyConfig?.[dayKey] || {}
    const optimized = optimizeDayVisits(
      day.visits,
      cfg.start_lat ?? therapist?.default_start_lat,
      cfg.start_lng ?? therapist?.default_start_lng,
      cfg.end_lat   ?? therapist?.default_end_lat,
      cfg.end_lng   ?? therapist?.default_end_lng,
    )
    applyOneDay(dayKey, optimized)
    toast.success('Itinéraire optimisé ✓')
  }

  // ── DnD cards mode ────────────────────────────────────────────────────────
  function handleDragStartPatient(e, patient) {
    setDragging({ type: 'patient', patientId: patient.id })
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDragStartVisit(e, dayKey, visitIdx) {
    setDragging({ type: 'visit', sourceDay: dayKey, sourceIdx: visitIdx })
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOverColumn(e, dayKey) {
    e.preventDefault()
    const n = days.find((d) => d.day === dayKey)?.visits.length ?? 0
    if (!dropTarget || dropTarget.dayKey !== dayKey || dropTarget.insertIdx !== n)
      setDropTarget({ dayKey, insertIdx: n })
  }

  function handleDragOverCard(e, dayKey, visitIdx) {
    e.preventDefault()
    e.stopPropagation()
    const rect      = e.currentTarget.getBoundingClientRect()
    const insertIdx = e.clientY < rect.top + rect.height / 2 ? visitIdx : visitIdx + 1
    if (!dropTarget || dropTarget.dayKey !== dayKey || dropTarget.insertIdx !== insertIdx)
      setDropTarget({ dayKey, insertIdx })
  }

  // ── DnD timeline mode ────────────────────────────────────────────────────
  function handleDragOverTimeline(e, dayKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!tlScrollRef.current) return
    const rect = tlScrollRef.current.getBoundingClientRect()
    const y    = (e.clientY - rect.top) + tlScrollRef.current.scrollTop
    const min  = Math.max(TL_START, Math.min(TL_END - 15, snapMin(TL_START + (y / TL_H) * TL_SPAN)))
    if (!dropTime || dropTime.dayKey !== dayKey || dropTime.min !== min) setDropTime({ dayKey, min })
  }

  function handleDropTimeline(e, dayKey) {
    e.preventDefault()
    if (!dragging || !dropTime) { reset(); setDropTime(null); return }
    const startMin  = dropTime.min
    const targetDay = days.find((d) => d.day === dayKey)
    if (!targetDay) { reset(); setDropTime(null); return }

    if (dragging.type === 'patient') {
      const p = activePatients.find((pt) => pt.id === dragging.patientId)
      if (!p || targetDay.visits.some((v) => v.patient_id === p.id)) { reset(); setDropTime(null); return }
      const dur = p.session_duration_min ?? 30
      const nv  = {
        patient_id: p.id, patient_name: p.full_name, address: p.address,
        lat: p.lat ?? null, lng: p.lng ?? null,
        session_duration_min: dur, estimated_travel_min: 10, estimated_km: null,
        start_time: fmtMin(startMin), end_time: fmtMin(startMin + dur), done: false, is_fixed: false,
      }
      applyOneDayDirect(dayKey, [...targetDay.visits, nv])
    } else if (dragging.type === 'visit') {
      const srcDay = days.find((d) => d.day === dragging.sourceDay)
      const visit  = srcDay?.visits[dragging.sourceIdx]
      if (!visit) { reset(); setDropTime(null); return }
      const dur     = visit.session_duration_min ?? 30
      const updated = { ...visit, start_time: fmtMin(startMin), end_time: fmtMin(startMin + dur) }
      if (dragging.sourceDay === dayKey) {
        applyOneDayDirect(dayKey, srcDay.visits.map((v, i) => i === dragging.sourceIdx ? updated : v))
      } else {
        if (targetDay.visits.some((v) => v.patient_id === visit.patient_id)) { reset(); setDropTime(null); return }
        applyTwoDaysDirect(dragging.sourceDay, srcDay.visits.filter((_, i) => i !== dragging.sourceIdx), dayKey, [...targetDay.visits, updated])
      }
    }
    reset(); setDropTime(null)
  }

  function handleDrop(e, dayKey) {
    e.preventDefault()
    if (!dragging) return
    const targetDay = days.find((d) => d.day === dayKey)
    if (!targetDay) { reset(); return }

    const insertIdx = dropTarget?.dayKey === dayKey ? dropTarget.insertIdx : targetDay.visits.length

    if (dragging.type === 'patient') {
      const p = activePatients.find((pt) => pt.id === dragging.patientId)
      if (!p || targetDay.visits.some((v) => v.patient_id === p.id)) { reset(); return }
      const newVisit = {
        patient_id: p.id, patient_name: p.full_name, address: p.address,
        lat: p.lat ?? null, lng: p.lng ?? null,
        session_duration_min: p.session_duration_min ?? 30,
        estimated_travel_min: 10, estimated_km: null, done: false, is_fixed: false,
      }
      const newVisits = [...targetDay.visits.slice(0, insertIdx), newVisit, ...targetDay.visits.slice(insertIdx)]
      applyOneDay(dayKey, newVisits)

    } else if (dragging.type === 'visit') {
      const sourceDay = days.find((d) => d.day === dragging.sourceDay)
      if (!sourceDay) { reset(); return }
      const visit = sourceDay.visits[dragging.sourceIdx]
      if (!visit) { reset(); return }

      if (dragging.sourceDay === dayKey) {
        // Reorder within same day
        const nv = [...sourceDay.visits]
        const [moved] = nv.splice(dragging.sourceIdx, 1)
        nv.splice(insertIdx > dragging.sourceIdx ? insertIdx - 1 : insertIdx, 0, moved)
        applyOneDay(dayKey, nv)
      } else {
        // Cross-day move
        if (targetDay.visits.some((v) => v.patient_id === visit.patient_id)) { reset(); return }
        const srcVisits = sourceDay.visits.filter((_, i) => i !== dragging.sourceIdx)
        const tgtVisits = [...targetDay.visits.slice(0, insertIdx), visit, ...targetDay.visits.slice(insertIdx)]
        applyTwoDays(dragging.sourceDay, srcVisits, dayKey, tgtVisits)
      }
    }
    reset()
  }

  function reset() { setDragging(null); setDropTarget(null) }

  function removeVisit(dayKey, visitIdx) {
    const day = days.find((d) => d.day === dayKey)
    if (day) applyOneDay(dayKey, day.visits.filter((_, i) => i !== visitIdx))
  }

  // ── Shared sidebar + visit card renderers ────────────────────────────────────
  function renderSidebar() {
    return (
      <div className={`week-sidebar${sidebarOpen ? '' : ' week-sidebar--collapsed'}`}>
        <div className="week-sidebar-header">
          {sidebarOpen && <span>Patients ({activePatients.length})</span>}
          <button className="week-sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        {sidebarOpen && (
          <div className="week-sidebar-list">
            {activePatients.map((p) => {
              const isScheduled = scheduledIds.has(p.id)
              const isDrag      = dragging?.type === 'patient' && dragging.patientId === p.id
              return (
                <div key={p.id} className={`patient-chip${isDrag ? ' patient-chip--dragging' : ''}`}
                  draggable onDragStart={(e) => handleDragStartPatient(e, p)}>
                  <Avatar name={p.full_name} size={26} />
                  <div className="patient-chip-info">
                    <div className="patient-chip-name" title={p.full_name}>{p.full_name}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {isScheduled && <span className="badge badge-green badge-xs">✓</span>}
                      {p.sessions_per_week > 1 && <span className="badge badge-inactive badge-xs">{p.sessions_per_week}×/sem</span>}
                    </div>
                  </div>
                </div>
              )
            })}
            {activePatients.length === 0 && <div className="small muted" style={{ padding: '8px 4px', textAlign: 'center' }}>Aucun patient actif</div>}
          </div>
        )}
      </div>
    )
  }

  function renderDayHeader(day, { showOptimize = true } = {}) {
    const cfg       = weeklyConfig?.[day.day] || {}
    const startLat  = cfg.start_lat ?? therapist?.default_start_lat
    const startLng  = cfg.start_lng ?? therapist?.default_start_lng
    const endLat    = cfg.end_lat   ?? therapist?.default_end_lat
    const endLng    = cfg.end_lng   ?? therapist?.default_end_lng
    const dayLabel  = DAY_LABELS_FR[day.day] || day.day
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    const doneCount = day.visits.filter((v) => completions[`${v.patient_id}|${day.date}`]?.done ?? v.done).length
    const travelMin = day.stats?.total_travel_min
    const kmDay     = day.stats?.total_km
    return (
      <>
        <div className="week-col-day-name">{dayLabel}</div>
        <div className="week-col-date">{dateLabel}</div>
        <div className="week-col-times">
          <label className="week-time-label" title="Départ">▶
            <input type="time" className="week-time-input" value={getWorkStart(day.day)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => updateDayTime(day.day, 'work_start', e.target.value)} />
          </label>
          <label className="week-time-label" title="Fin">◀
            <input type="time" className="week-time-input" value={getWorkEnd(day.day)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => updateDayTime(day.day, 'work_end', e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
          <span className={`badge badge-xs ${doneCount === day.visits.length && day.visits.length > 0 ? 'badge-green' : 'badge-inactive'}`}>{doneCount}/{day.visits.length}</span>
          {kmDay != null && <span className="badge badge-xs badge-blue">{kmDay} km</span>}
          {travelMin != null && <span className="badge badge-xs" style={{ background: '#f3e8ff', color: '#7c3aed' }}>{travelMin} min</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
          {showOptimize && day.visits.length >= 2 && (
            <button className="week-optimize-btn" onClick={() => handleOptimizeDay(day.day)}>⚡ Optimiser</button>
          )}
          {day.visits.length > 0 && (
            <button className="week-col-launch" style={{ flex: 1 }}
              onClick={() => launchFullRoute(day.visits, startLat, startLng, endLat, endLng)}>
              🚀 Lancer
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="week-drag-view" onDragEnd={reset}>
      {renderSidebar()}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* ── Toggle mode ── */}
        <div className="week-mode-bar">
          <button className={`week-mode-btn${viewMode === 'cards' ? ' active' : ''}`} onClick={() => setViewMode('cards')}>📋 Cartes</button>
          <button className={`week-mode-btn${viewMode === 'timeline' ? ' active' : ''}`} onClick={() => setViewMode('timeline')}>⏱ Timeline</button>
        </div>

        {/* ════════════════════ MODE CARTES ════════════════════ */}
        {viewMode === 'cards' && (
          <div className="week-columns">
            {days.map((day) => {
              const isDropActive = dropTarget?.dayKey === day.day
              return (
                <div key={day.date}
                  className={`week-col${isDropActive ? ' week-col--drop-active' : ''}`}
                  onDragOver={(e) => handleDragOverColumn(e, day.day)}
                  onDrop={(e) => handleDrop(e, day.day)}>
                  <div className="week-col-header">{renderDayHeader(day)}</div>
                  <div className="week-col-body">
                    {isDropActive && dropTarget.insertIdx === 0 && <div className="week-drop-indicator" />}
                    {day.visits.map((v, i) => {
                      const key    = `${v.patient_id}|${day.date}`
                      const isDone = completions[key]?.done ?? v.done
                      const isDrag = dragging?.type === 'visit' && dragging.sourceDay === day.day && dragging.sourceIdx === i
                      const color  = getColor(v.patient_name)
                      return (
                        <div key={`${v.patient_id}-${i}`}>
                          <div className={`week-visit-card${isDone ? ' week-visit-card--done' : ''}${isDrag ? ' week-visit-card--dragging' : ''}`}
                            style={{ borderLeft: `3px solid ${color}` }}
                            draggable
                            onDragStart={(e) => handleDragStartVisit(e, day.day, i)}
                            onDragOver={(e) => handleDragOverCard(e, day.day, i)}>
                            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                              <div className="week-visit-name" style={{ flex: 1 }} title={v.patient_name}>{v.patient_name}</div>
                              <input type="checkbox" checked={isDone} className="visit-check"
                                style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }}
                                onChange={() => onCompletionToggle(v.patient_id, day.date, !isDone)}
                                onClick={(e) => e.stopPropagation()} />
                              <button className="week-visit-remove" onClick={() => removeVisit(day.day, i)} title="Retirer">✕</button>
                            </div>
                            <div className="week-visit-time">{v.start_time} – {v.end_time} · {v.session_duration_min} min</div>
                            {v.address && (
                              <div className="week-visit-addr-row">
                                <span className="week-visit-addr" title={v.address}>{v.address}</span>
                                {v.lat && v.lng && (
                                  <span className="week-visit-gps">
                                    <button className="week-gps-btn" onClick={() => navigateTo(v.lat, v.lng)}>🗺</button>
                                    <button className="week-gps-btn" onClick={() => navigateWaze(v.lat, v.lng)}>🚗</button>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {isDropActive && dropTarget.insertIdx === i + 1 && <div className="week-drop-indicator" />}
                        </div>
                      )
                    })}
                    {day.visits.length === 0 && (
                      <div className="week-col-empty">{isDropActive ? 'Déposer ici' : 'Glissez un patient'}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ════════════════════ MODE TIMELINE ════════════════════ */}
        {viewMode === 'timeline' && (
          <div className="week-tl-wrap">
            {/* En-têtes des jours (sticky) */}
            <div className="week-tl-header">
              <div className="week-tl-corner" />
              {days.map((day) => (
                <div key={day.date} className="week-tl-col-header">
                  {renderDayHeader(day)}
                </div>
              ))}
            </div>

            {/* Corps scrollable */}
            <div className="week-tl-scroll" ref={tlScrollRef}>
              {/* Axe horaire */}
              <div className="week-tl-axis" style={{ height: TL_H }}>
                {Array.from({ length: (TL_END - TL_START) / 60 + 1 }, (_, i) => TL_START + i * 60).map((m) => (
                  <div key={m} className="week-tl-hour-label" style={{ top: minToTopPx(m) }}>{fmtMin(m)}</div>
                ))}
              </div>

              {/* Colonnes jours */}
              {days.map((day) => {
                const isTlDrop = dropTime?.dayKey === day.day
                return (
                  <div key={day.date}
                    className={`week-tl-col${isTlDrop ? ' week-tl-col--drop' : ''}`}
                    style={{ height: TL_H }}
                    onDragOver={(e) => handleDragOverTimeline(e, day.day)}
                    onDrop={(e) => handleDropTimeline(e, day.day)}>

                    {/* Grille toutes les 30 min */}
                    {Array.from({ length: (TL_END - TL_START) / 30 }, (_, i) => TL_START + i * 30).map((m) => (
                      <div key={m}
                        className={`week-tl-grid-line${m % 60 === 0 ? '' : ' week-tl-grid-line--half'}`}
                        style={{ top: minToTopPx(m) }} />
                    ))}

                    {/* Plage de travail (fond légèrement coloré) */}
                    {(() => {
                      const ws = parseMin(getWorkStart(day.day))
                      const we = parseMin(getWorkEnd(day.day))
                      return (
                        <div className="week-tl-work-zone" style={{
                          top: minToTopPx(Math.max(ws, TL_START)),
                          height: minToTopPx(Math.min(we, TL_END)) - minToTopPx(Math.max(ws, TL_START)),
                        }} />
                      )
                    })()}

                    {/* Blocs visites */}
                    {day.visits.map((v, i) => {
                      const key    = `${v.patient_id}|${day.date}`
                      const isDone = completions[key]?.done ?? v.done
                      const isDrag = dragging?.type === 'visit' && dragging.sourceDay === day.day && dragging.sourceIdx === i
                      const color  = getColor(v.patient_name)
                      const top    = minToTopPx(parseMin(v.start_time))
                      const h      = durToHPx(v.session_duration_min ?? 30)
                      return (
                        <div key={`${v.patient_id}-${i}`}
                          className={`week-tl-block${isDone ? ' week-tl-block--done' : ''}${isDrag ? ' week-tl-block--dragging' : ''}`}
                          style={{ top, height: h, background: color + '22', borderLeft: `3px solid ${color}`, borderTop: `1px solid ${color}55` }}
                          draggable
                          onDragStart={(e) => handleDragStartVisit(e, day.day, i)}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="week-visit-name">{v.patient_name}</div>
                              <div className="week-visit-time">{v.start_time} – {v.end_time}</div>
                            </div>
                            <input type="checkbox" checked={isDone} className="visit-check"
                              style={{ width: 12, height: 12, marginTop: 1 }}
                              onChange={() => onCompletionToggle(v.patient_id, day.date, !isDone)}
                              onClick={(e) => e.stopPropagation()} />
                          </div>
                          {h >= 44 && v.address && <div className="week-visit-addr" style={{ marginTop: 2 }}>{v.address}</div>}
                          {h >= 58 && v.lat && v.lng && (
                            <div className="week-visit-gps" style={{ marginTop: 3 }}>
                              <button className="week-gps-btn" onClick={() => navigateTo(v.lat, v.lng)}>🗺</button>
                              <button className="week-gps-btn" onClick={() => navigateWaze(v.lat, v.lng)}>🚗</button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Indicateur de dépôt */}
                    {isTlDrop && (
                      <>
                        <div className="week-tl-drop-line" style={{ top: minToTopPx(dropTime.min) }} />
                        <div className="week-tl-drop-label" style={{ top: minToTopPx(dropTime.min) }}>{fmtMin(dropTime.min)}</div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
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
export default function SchedulePage({ schedule, setSchedule, weekStart, setWeekStart, onGenerate, therapist, weeklyConfig, setWeeklyConfig, generating, patients }) {
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
    // Recalculer les horaires selon le nouvel ordre
    const dayConfig = weeklyConfig?.[dayKey]
    const workStart = dayConfig?.work_start ?? '08:00'
    const sessionBuffer = therapist?.session_buffer_min ?? 5
    const recalculated = recalcTimes(newVisits, workStart, sessionBuffer)

    setSchedule((prev) => {
      const updated = {
        ...prev,
        days: prev.days.map((d) => d.day === dayKey ? { ...d, visits: recalculated } : d),
      }
      // Auto-save avec debounce
      clearTimeout(handleVisitsReorder._timer)
      handleVisitsReorder._timer = setTimeout(() => {
        api.saveSchedule(prev.week_start, updated).catch(() => {})
      }, 1500)
      return updated
    })
  }
  handleVisitsReorder._timer = null

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
                <button className={viewMode === 'table'    ? 'active' : ''} onClick={() => setViewMode('table')}>≡ Liste</button>
                <button className={viewMode === 'timeline' ? 'active' : ''} onClick={() => setViewMode('timeline')}>⏱ Timeline</button>
                <button className={viewMode === 'week'     ? 'active' : ''} onClick={() => setViewMode('week')}>📅 Semaine</button>
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
          {viewMode === 'week' ? (
            <WeeklyDragView
              schedule={schedule}
              setSchedule={setSchedule}
              therapist={therapist}
              weeklyConfig={weeklyConfig}
              setWeeklyConfig={setWeeklyConfig}
              completions={completions}
              onCompletionToggle={handleCompletionToggle}
              patients={patients || []}
            />
          ) : (
            schedule.days.map((day) => (
              <DayBlock key={day.date} day={day} therapist={therapist} weeklyConfig={weeklyConfig}
                completions={completions} onCompletionToggle={handleCompletionToggle}
                onVisitsReorder={handleVisitsReorder} viewMode={viewMode} userPosition={userPosition}
                patients={patients || []} />
            ))
          )}
          <div className="print-only print-header">
            <h1>Tournée — Semaine du {weekStart}</h1>
            {schedule.week_stats && <p>{schedule.week_stats.total_visits} visites · {schedule.week_stats.total_km} km · {new Date(schedule.generated_at).toLocaleDateString('fr-FR')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
