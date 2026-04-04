import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

const DAY_LABELS_FR = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
}

// ── Carte Leaflet ─────────────────────────────────────────────────────────────
function DayMap({ day, startLat, startLng, endLat, endLng }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    const L = window.L
    if (!L || !mapRef.current) return
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }

    const map = L.map(mapRef.current, { zoomControl: true })
    mapInstanceRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map)

    const points = []

    // Point de départ
    if (startLat && startLng) {
      const icon = L.divIcon({ className: '', html: '<div class="map-marker map-marker--start">D</div>', iconSize: [32, 32], iconAnchor: [16, 16] })
      L.marker([startLat, startLng], { icon }).addTo(map).bindPopup('Départ')
      points.push([startLat, startLng])
    }

    // Visites
    day.visits.forEach((v, i) => {
      if (!v.lat || !v.lng) return
      const icon = L.divIcon({ className: '', html: `<div class="map-marker map-marker--visit ${v.done ? 'map-marker--done' : ''}">${i + 1}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
      L.marker([v.lat, v.lng], { icon })
        .addTo(map)
        .bindPopup(`<strong>${v.patient_name}</strong><br>${v.start_time} – ${v.end_time}<br>${v.address}`)
      points.push([v.lat, v.lng])
    })

    // Point d'arrivée
    if (endLat && endLng) {
      const icon = L.divIcon({ className: '', html: '<div class="map-marker map-marker--end">A</div>', iconSize: [32, 32], iconAnchor: [16, 16] })
      L.marker([endLat, endLng], { icon }).addTo(map).bindPopup('Arrivée')
      points.push([endLat, endLng])
    }

    // Tracé de la route
    if (points.length > 1) {
      L.polyline(points, { color: '#184f3b', weight: 3, opacity: 0.7 }).addTo(map)
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32] })
    } else if (points.length === 1) {
      map.setView(points[0], 14)
    } else {
      map.setView([46.6, 2.3], 6)
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [day, startLat, startLng, endLat, endLng])

  return <div ref={mapRef} style={{ height: 320, borderRadius: 12, marginTop: 8 }} />
}

// ── Stats d'une journée ───────────────────────────────────────────────────────
function DayStats({ stats, returnMin, returnKm }) {
  if (!stats) return null
  const totalMin = (stats.total_travel_min || 0) + (stats.total_session_min || 0)
  const travelPct = totalMin ? Math.round((stats.total_travel_min / totalMin) * 100) : 0

  return (
    <div className="day-stats">
      <div className="stat-pill">
        <span className="stat-value">{stats.total_visits}</span>
        <span className="stat-label">visites</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{stats.total_km ?? '–'} km</span>
        <span className="stat-label">trajet</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{stats.total_session_min} min</span>
        <span className="stat-label">soins</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{stats.total_travel_min} min</span>
        <span className="stat-label">déplacement</span>
      </div>
      <div className="stat-pill">
        <span className="stat-value">{travelPct}%</span>
        <span className="stat-label">temps trajet</span>
      </div>
    </div>
  )
}

// ── Ligne d'une visite (draggable) ────────────────────────────────────────────
function VisitRow({ visit, index, dayDate, completions, onCompletionToggle, onDragStart, onDragOver, onDrop }) {
  const key = `${visit.patient_id}|${dayDate}`
  const completion = completions[key]
  const isDone = completion?.done ?? visit.done ?? false

  return (
    <tr
      className={`visit-row ${isDone ? 'visit-row--done' : ''} ${visit.is_fixed ? 'visit-row--fixed' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e, index) }}
      onDrop={(e) => onDrop(e, index)}
    >
      <td className="drag-handle" title="Glisser pour réorganiser">⠿</td>
      <td>
        <input
          type="checkbox"
          checked={isDone}
          onChange={() => onCompletionToggle(visit.patient_id, dayDate, !isDone, completion?.notes)}
          className="visit-check"
          title="Marquer comme effectuée"
        />
      </td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <span>{visit.patient_name}</span>
          {visit.is_fixed && <span className="badge badge-fixed badge-xs">Fixe</span>}
        </div>
        <div className="small muted">{visit.address}</div>
      </td>
      <td>{visit.start_time} → {visit.end_time}</td>
      <td>
        <div>{visit.estimated_travel_min} min</div>
        {visit.estimated_km !== undefined && <div className="small muted">{visit.estimated_km} km</div>}
      </td>
      <td>{visit.session_duration_min} min</td>
    </tr>
  )
}

// ── Bloc journée ──────────────────────────────────────────────────────────────
function DayBlock({
  day,
  therapist,
  weeklyConfig,
  completions,
  onCompletionToggle,
  onVisitsReorder,
  showMap,
}) {
  const [dragFrom, setDragFrom] = useState(null)
  const [showMapLocal, setShowMapLocal] = useState(false)

  function handleDragStart(e, i) {
    setDragFrom(i)
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e, i) {
    e.preventDefault()
  }
  function handleDrop(e, dropIdx) {
    e.preventDefault()
    if (dragFrom === null || dragFrom === dropIdx) return
    const newVisits = [...day.visits]
    const [moved] = newVisits.splice(dragFrom, 1)
    newVisits.splice(dropIdx, 0, moved)
    onVisitsReorder(day.day, newVisits)
    setDragFrom(null)
  }

  const dayConfig = weeklyConfig?.[day.day] || {}
  const startLat = dayConfig.start_lat ?? therapist?.default_start_lat
  const startLng = dayConfig.start_lng ?? therapist?.default_start_lng
  const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
  const endLng = dayConfig.end_lng ?? therapist?.default_end_lng

  const dayLabel = `${DAY_LABELS_FR[day.day] || day.day} ${day.date}`
  const doneCount = day.visits.filter((v) => {
    const k = `${v.patient_id}|${day.date}`
    return completions[k]?.done ?? v.done
  }).length

  return (
    <div className="card">
      {/* En-tête */}
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{dayLabel}</strong>
          {day.visits.length > 0 && (
            <span className="small muted" style={{ marginLeft: 10 }}>
              {doneCount}/{day.visits.length} effectuées
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="small muted">
            {day.start_address ? `Départ: ${day.start_address}` : ''}
          </span>
          {day.visits.length > 0 && (
            <button
              className="secondary small-btn"
              onClick={() => setShowMapLocal((v) => !v)}
            >
              {showMapLocal ? '🗺 Masquer carte' : '🗺 Voir carte'}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {day.visits.length > 0 && (
        <DayStats stats={day.stats} returnMin={day.estimated_return_travel_min} returnKm={day.estimated_return_km} />
      )}

      {/* Carte */}
      {showMapLocal && window.L && (
        <DayMap
          day={day}
          startLat={startLat}
          startLng={startLng}
          endLat={endLat}
          endLng={endLng}
        />
      )}

      {/* Table des visites */}
      {day.visits.length === 0 && (
        <div className="small muted">Aucune visite planifiée.</div>
      )}
      {day.visits.length > 0 && (
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
              </tr>
            </thead>
            <tbody>
              {day.visits.map((visit, i) => (
                <VisitRow
                  key={`${visit.patient_id}-${visit.start_time}`}
                  visit={visit}
                  index={i}
                  dayDate={day.date}
                  completions={completions}
                  onCompletionToggle={onCompletionToggle}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Retour domicile */}
      {day.visits.length > 0 && day.estimated_return_travel_min !== undefined && (
        <div className="small muted" style={{ marginTop: 4 }}>
          Retour : ~{day.estimated_return_travel_min} min
          {day.estimated_return_km ? ` / ${day.estimated_return_km} km` : ''} vers {day.end_address || 'domicile'}
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
          {routingSource === 'osrm' ? '🛣 OSRM (temps réels)' : '📐 Euclidien (estimation)'}
        </span>
      </div>
      <div className="week-stats-grid">
        <div className="stat-card">
          <div className="stat-card-value">{total_visits}</div>
          <div className="stat-card-label">visites</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{total_km} km</div>
          <div className="stat-card-label">parcourus</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{Math.round(total_session_min / 60)}h{String(total_session_min % 60).padStart(2, '0')}</div>
          <div className="stat-card-label">de soins</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{Math.round(total_travel_min / 60)}h{String(total_travel_min % 60).padStart(2, '0')}</div>
          <div className="stat-card-label">de trajet</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{travelPct}%</div>
          <div className="stat-card-label">temps trajet</div>
        </div>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function SchedulePage({
  schedule,
  setSchedule,
  weekStart,
  setWeekStart,
  onGenerate,
  therapist,
  weeklyConfig,
  generating,
}) {
  const [completions, setCompletions] = useState({}) // key: "patientId|date"
  const [loadingCompletions, setLoadingCompletions] = useState(false)
  const [saving, setSaving] = useState(false)

  // Charger les completions quand le planning change
  useEffect(() => {
    if (!schedule?.week_start) return
    setLoadingCompletions(true)
    api.getCompletions(schedule.week_start)
      .then((data) => {
        const map = {}
        data.forEach((c) => { map[`${c.patient_id}|${c.visit_date}`] = c })
        setCompletions(map)
      })
      .catch(() => {})
      .finally(() => setLoadingCompletions(false))
  }, [schedule?.week_start, schedule?.generated_at])

  async function handleCompletionToggle(patientId, visitDate, done, notes) {
    const key = `${patientId}|${visitDate}`
    try {
      const updated = await api.upsertCompletion({ patient_id: patientId, visit_date: visitDate, done, notes })
      setCompletions((prev) => ({ ...prev, [key]: updated }))
    } catch (e) {
      console.error(e)
    }
  }

  function handleVisitsReorder(dayKey, newVisits) {
    setSchedule((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.day === dayKey ? { ...d, visits: newVisits } : d
      ),
    }))
  }

  async function handleSaveManual() {
    if (!schedule) return
    setSaving(true)
    try {
      await api.saveSchedule(schedule.week_start, schedule)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  const activeDays = schedule?.days?.filter((d) => d.visits.length > 0) || []
  const totalDone = activeDays.reduce((acc, d) => {
    return acc + d.visits.filter((v) => completions[`${v.patient_id}|${d.date}`]?.done ?? v.done).length
  }, 0)
  const totalVisits = activeDays.reduce((acc, d) => acc + d.visits.length, 0)

  return (
    <div className="grid" id="schedule-page">
      {/* Contrôles */}
      <div className="card row no-print" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Semaine du lundi</span>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" onClick={onGenerate} disabled={generating}>
            {generating ? '⏳ Génération OSRM…' : '⚡ Générer la tournée'}
          </button>
          {schedule && (
            <>
              <button className="secondary" onClick={handleSaveManual} disabled={saving} title="Sauvegarder les modifications manuelles (drag & drop)">
                {saving ? '…' : '💾 Sauvegarder'}
              </button>
              <button className="secondary" onClick={handlePrint} title="Imprimer le planning">
                🖨 Imprimer
              </button>
            </>
          )}
        </div>
      </div>

      {!schedule && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: '#5b6a65' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div>Aucune tournée générée pour l'instant.</div>
          <div className="small" style={{ marginTop: 6 }}>Cliquez sur « Générer la tournée » pour optimiser votre semaine.</div>
        </div>
      )}

      {schedule && (
        <>
          {/* Indicateur de progression */}
          {totalVisits > 0 && (
            <div className="card no-print" style={{ padding: '12px 16px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small">Progression : <strong>{totalDone}/{totalVisits}</strong> séances effectuées</span>
                <span className="small muted">{Math.round((totalDone / totalVisits) * 100)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.round((totalDone / totalVisits) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* Stats semaine */}
          <WeekStats weekStats={schedule.week_stats} routingSource={schedule.routing_source} />

          {/* Jours */}
          {schedule.days.map((day) => (
            <DayBlock
              key={day.date}
              day={day}
              therapist={therapist}
              weeklyConfig={weeklyConfig}
              completions={completions}
              onCompletionToggle={handleCompletionToggle}
              onVisitsReorder={handleVisitsReorder}
            />
          ))}

          {/* En-tête d'impression uniquement */}
          <div className="print-only print-header">
            <h1>Tournée — Semaine du {weekStart}</h1>
            {schedule.week_stats && (
              <p>{schedule.week_stats.total_visits} visites · {schedule.week_stats.total_km} km · généré le {new Date(schedule.generated_at).toLocaleDateString('fr-FR')}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
