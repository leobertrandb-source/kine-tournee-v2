import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { launchFullRoute, navigateTo, navigateWaze } from '../lib/gps'
import { useToast } from '../components/Toast'

const PATIENT_COLORS = ['#184f3b','#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#9333ea']
function getColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return PATIENT_COLORS[Math.abs(h) % PATIENT_COLORS.length]
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

const DAY_LABELS_FR = {
  monday:'Lundi', tuesday:'Mardi', wednesday:'Mercredi',
  thursday:'Jeudi', friday:'Vendredi', saturday:'Samedi', sunday:'Dimanche'
}

export default function NavigationPage({ schedule, weeklyConfig, therapist }) {
  const toast = useToast()
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const userMarker = useRef(null)
  const watchId = useRef(null)
  const markersRef = useRef([])
  const polylineRef = useRef(null)
  const accuracyCircle = useRef(null)

  const [position, setPosition] = useState(null)
  const [tracking, setTracking] = useState(false)
  const [accuracy, setAccuracy] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [completions, setCompletions] = useState({})
  const [nearbyVisit, setNearbyVisit] = useState(null)

  // Choisir le jour par défaut = aujourd'hui (si planifié) sinon premier jour actif
  useEffect(() => {
    if (!schedule?.days) return
    const today = new Date().toISOString().slice(0, 10)
    const todayDay = schedule.days.find((d) => d.date === today && d.visits.length > 0)
    const firstActive = schedule.days.find((d) => d.visits.length > 0)
    setSelectedDay(todayDay?.day || firstActive?.day || null)
  }, [schedule])

  // Charger completions
  useEffect(() => {
    if (!schedule?.week_start) return
    api.getCompletions(schedule.week_start)
      .then((data) => {
        const map = {}
        data.forEach((c) => { map[`${c.patient_id}|${c.visit_date}`] = c })
        setCompletions(map)
      }).catch(() => {})
  }, [schedule?.week_start])

  const currentDay = schedule?.days?.find((d) => d.day === selectedDay)
  const visits = currentDay?.visits || []
  const dayConfig = weeklyConfig?.[selectedDay] || {}

  const pendingVisits = visits.filter((v) => !completions[`${v.patient_id}|${currentDay?.date}`]?.done)
  const nextVisit = pendingVisits[0] || null
  const doneCount = visits.length - pendingVisits.length

  // ── Initialiser la carte ─────────────────────────────────────────────────
  useEffect(() => {
    const L = window.L
    if (!L || !mapRef.current) return
    if (mapInstance.current) return

    const map = L.map(mapRef.current, { zoomControl: true })
    mapInstance.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    map.setView([46.6, 2.3], 6)

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current)
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  // ── Redessiner la tournée quand le jour change ────────────────────────────
  useEffect(() => {
    const L = window.L
    const map = mapInstance.current
    if (!L || !map || !currentDay) return

    // Supprimer anciens marqueurs
    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current = []
    if (polylineRef.current) { map.removeLayer(polylineRef.current); polylineRef.current = null }

    const bounds = []
    const routePoints = []

    // Départ
    const startLat = dayConfig.start_lat ?? therapist?.default_start_lat
    const startLng = dayConfig.start_lng ?? therapist?.default_start_lng
    if (startLat && startLng) {
      const icon = L.divIcon({ className: '', html: '<div class="map-marker map-marker--start">D</div>', iconSize: [32,32], iconAnchor: [16,16] })
      const m = L.marker([startLat, startLng], { icon }).addTo(map).bindPopup('Départ')
      markersRef.current.push(m)
      bounds.push([startLat, startLng])
      routePoints.push([startLat, startLng])
    }

    // Visites
    visits.forEach((v, i) => {
      if (!v.lat || !v.lng) return
      const isDone = !!completions[`${v.patient_id}|${currentDay.date}`]?.done
      const color = getColor(v.patient_name)
      const icon = L.divIcon({
        className: '',
        html: `<div class="map-marker map-marker--visit nav-marker ${isDone ? 'nav-marker--done' : ''}" style="background:${isDone ? '#22c55e' : color}">${i+1}</div>`,
        iconSize: [36,36], iconAnchor: [18,18]
      })
      const m = L.marker([v.lat, v.lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="min-width:160px"><strong>${v.patient_name}</strong><br><span style="color:#6b7280">${v.start_time}–${v.end_time}</span><br><small>${v.address}</small>${isDone ? '<br><span style="color:#16a34a;font-weight:600">✓ Effectuée</span>' : ''}</div>`)
      markersRef.current.push(m)
      bounds.push([v.lat, v.lng])
      routePoints.push([v.lat, v.lng])
    })

    // Arrivée
    const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
    const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
    if (endLat && endLng) {
      const icon = L.divIcon({ className: '', html: '<div class="map-marker map-marker--end">A</div>', iconSize: [32,32], iconAnchor: [16,16] })
      const m = L.marker([endLat, endLng], { icon }).addTo(map).bindPopup('Arrivée')
      markersRef.current.push(m)
      bounds.push([endLat, endLng])
      routePoints.push([endLat, endLng])
    }

    if (routePoints.length > 1) {
      polylineRef.current = L.polyline(routePoints, { color: '#184f3b', weight: 3, opacity: .7, dashArray: '8,5' }).addTo(map)
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] })
    }
  }, [selectedDay, completions, visits.length])

  // ── Tracking GPS ──────────────────────────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) { toast.error('Géolocalisation non supportée'); return }
    const L = window.L
    const map = mapInstance.current
    if (!L || !map) return

    setTracking(true)
    toast.info('Localisation activée')

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setPosition({ lat, lng })
        setAccuracy(Math.round(acc))

        // Marqueur position utilisateur
        const html = `<div class="user-marker"><div class="user-marker-dot"></div><div class="user-marker-ring"></div></div>`
        const icon = L.divIcon({ className: '', html, iconSize: [40,40], iconAnchor: [20,20] })

        if (userMarker.current) {
          userMarker.current.setLatLng([lat, lng])
          userMarker.current.setIcon(icon)
        } else {
          userMarker.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map)
          userMarker.current.bindPopup('Ma position')
        }

        // Cercle de précision
        if (accuracyCircle.current) { map.removeLayer(accuracyCircle.current) }
        accuracyCircle.current = L.circle([lat, lng], {
          radius: acc, color: '#2563eb', fillColor: '#93c5fd',
          fillOpacity: .15, weight: 1
        }).addTo(map)

        // Centrer sur la position
        map.panTo([lat, lng], { animate: true })

        // Détecter si proche d'une visite (< 150m)
        const nearby = visits.find((v) => {
          if (!v.lat || !v.lng) return false
          const dist = haversineKm(lat, lng, v.lat, v.lng) * 1000
          return dist < 150
        })
        setNearbyVisit(nearby || null)
      },
      (err) => {
        toast.error(`GPS : ${err.message}`)
        setTracking(false)
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    )
  }, [visits, toast])

  const stopTracking = useCallback(() => {
    if (watchId.current) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
    if (userMarker.current && mapInstance.current) { mapInstance.current.removeLayer(userMarker.current); userMarker.current = null }
    if (accuracyCircle.current && mapInstance.current) { mapInstance.current.removeLayer(accuracyCircle.current); accuracyCircle.current = null }
    setTracking(false)
    setPosition(null)
    setNearbyVisit(null)
  }, [])

  async function markDone(visit) {
    try {
      const updated = await api.upsertCompletion({ patient_id: visit.patient_id, visit_date: currentDay.date, done: true })
      setCompletions((prev) => ({ ...prev, [`${visit.patient_id}|${currentDay.date}`]: updated }))
      toast.success(`${visit.patient_name} — séance marquée ✓`)
    } catch { toast.error('Erreur') }
  }

  async function markUndone(visit) {
    try {
      const updated = await api.upsertCompletion({ patient_id: visit.patient_id, visit_date: currentDay.date, done: false })
      setCompletions((prev) => ({ ...prev, [`${visit.patient_id}|${currentDay.date}`]: updated }))
    } catch { toast.error('Erreur') }
  }

  function centerOnUser() {
    if (position && mapInstance.current) {
      mapInstance.current.setView([position.lat, position.lng], 16, { animate: true })
    }
  }

  const activeDays = schedule?.days?.filter((d) => d.visits.length > 0) || []

  if (!schedule) {
    return (
      <div className="nav-page-empty">
        <div style={{ fontSize: 64, marginBottom: 16 }}>🧭</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Aucune tournée générée</div>
        <div className="small muted">Générez d'abord une tournée depuis l'onglet Planning.</div>
      </div>
    )
  }

  return (
    <div className="nav-page">
      {/* ── Carte ─────────────────────────────────────────────────────────── */}
      <div className="nav-map-container">
        <div ref={mapRef} className="nav-map" />

        {/* Boutons carte */}
        <div className="nav-map-controls">
          <button
            className={`nav-control-btn ${tracking ? 'nav-control-btn--active' : ''}`}
            onClick={tracking ? stopTracking : startTracking}
            title={tracking ? 'Arrêter le GPS' : 'Activer le GPS'}
          >
            {tracking ? '📍' : '🔍'}
          </button>
          {position && (
            <button className="nav-control-btn" onClick={centerOnUser} title="Centrer sur moi">
              🎯
            </button>
          )}
          {currentDay && visits.some((v) => v.lat && v.lng) && (
            <button
              className="nav-control-btn"
              onClick={() => launchFullRoute(
                visits,
                dayConfig.start_lat ?? therapist?.default_start_lat,
                dayConfig.start_lng ?? therapist?.default_start_lng,
                dayConfig.end_lat ?? therapist?.default_end_lat,
                dayConfig.end_lng ?? therapist?.default_end_lng
              )}
              title="Lancer dans Google Maps"
            >
              🚀
            </button>
          )}
        </div>

        {/* Badge GPS */}
        {tracking && (
          <div className="nav-gps-badge">
            <span className="nav-gps-dot" />
            GPS actif{accuracy ? ` · ±${accuracy}m` : ''}
          </div>
        )}

        {/* Alerte proximité */}
        {nearbyVisit && !completions[`${nearbyVisit.patient_id}|${currentDay?.date}`]?.done && (
          <div className="nav-nearby-alert">
            <div>
              <div style={{ fontWeight: 700 }}>Vous êtes arrivé !</div>
              <div className="small">{nearbyVisit.patient_name}</div>
            </div>
            <button className="primary small-btn" onClick={() => markDone(nearbyVisit)}>✓ Marquer</button>
          </div>
        )}
      </div>

      {/* ── Panneau bas ───────────────────────────────────────────────────── */}
      <div className="nav-panel">
        {/* Sélecteur de jour */}
        <div className="nav-day-tabs">
          {activeDays.map((d) => (
            <button
              key={d.day}
              className={`nav-day-tab ${selectedDay === d.day ? 'nav-day-tab--active' : ''}`}
              onClick={() => setSelectedDay(d.day)}
            >
              {new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
              <span className="nav-day-count">{d.visits.length}</span>
            </button>
          ))}
        </div>

        {currentDay && (
          <>
            {/* Progression */}
            <div className="nav-progress-row">
              <span className="small"><strong>{doneCount}/{visits.length}</strong> séances effectuées</span>
              <div className="progress-bar" style={{ flex: 1, maxWidth: 200 }}>
                <div className="progress-fill" style={{ width: `${visits.length ? (doneCount/visits.length)*100 : 0}%` }} />
              </div>
            </div>

            {/* Prochain patient */}
            {nextVisit && (
              <div className="nav-next-card">
                <div className="nav-next-label">Prochain patient</div>
                <div className="nav-next-content">
                  <div className="nav-next-info">
                    <div className="nav-next-name">{nextVisit.patient_name}</div>
                    <div className="small muted">{nextVisit.address}</div>
                    <div className="small muted">{nextVisit.start_time} → {nextVisit.end_time} · {nextVisit.session_duration_min} min</div>
                    {position && nextVisit.lat && nextVisit.lng && (
                      <div className="small" style={{ color: 'var(--green)', fontWeight: 600, marginTop: 2 }}>
                        ~{(haversineKm(position.lat, position.lng, nextVisit.lat, nextVisit.lng)).toFixed(1)} km de votre position
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {nextVisit.lat && nextVisit.lng && (
                      <>
                        <button className="btn-gps" onClick={() => navigateTo(nextVisit.lat, nextVisit.lng)}>🗺 Maps</button>
                        <button className="btn-gps" onClick={() => navigateWaze(nextVisit.lat, nextVisit.lng)}>🚗 Waze</button>
                      </>
                    )}
                    <button className="primary small-btn" onClick={() => markDone(nextVisit)}>✓ Fait</button>
                  </div>
                </div>
              </div>
            )}

            {!nextVisit && doneCount === visits.length && (
              <div className="nav-done-banner">
                🎉 Tournée terminée ! Bravo.
              </div>
            )}

            {/* Liste de toutes les visites */}
            <div className="nav-visits-list">
              {visits.map((v, i) => {
                const isDone = !!completions[`${v.patient_id}|${currentDay.date}`]?.done
                const color = getColor(v.patient_name)
                return (
                  <div key={`${v.patient_id}-${v.start_time}`} className={`nav-visit-item ${isDone ? 'nav-visit-item--done' : ''}`}>
                    <div className="nav-visit-num" style={{ background: isDone ? '#22c55e' : color }}>
                      {isDone ? '✓' : i+1}
                    </div>
                    <div className="nav-visit-info">
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{v.patient_name}</div>
                      <div className="small muted">{v.start_time} · {v.session_duration_min} min · {v.estimated_km ?? '?'} km</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {v.lat && v.lng && (
                        <button className="btn-gps" style={{ padding: '4px 7px' }} onClick={() => navigateTo(v.lat, v.lng)}>🗺</button>
                      )}
                      {isDone
                        ? <button className="secondary small-btn" onClick={() => markUndone(v)}>↩</button>
                        : <button className="primary small-btn" onClick={() => markDone(v)}>✓</button>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
