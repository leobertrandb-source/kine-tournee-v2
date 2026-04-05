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
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
}

export default function NavigationPage({ schedule, weeklyConfig, therapist, onGoToPlanning }) {
  const toast = useToast()
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const userMarker = useRef(null)
  const watchId = useRef(null)
  const markersRef = useRef([])
  const polylineRef = useRef(null)
  const accuracyCircle = useRef(null)

  const [position, setPosition] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('idle') // idle | starting | active | denied
  const [selectedDay, setSelectedDay] = useState(null)
  const [completions, setCompletions] = useState({})
  const [showList, setShowList] = useState(false)

  // Auto-select today or first active day
  useEffect(() => {
    if (!schedule?.days) return
    const today = new Date().toISOString().slice(0, 10)
    const todayDay = schedule.days.find((d) => d.date === today && d.visits.length > 0)
    const firstActive = schedule.days.find((d) => d.visits.length > 0)
    setSelectedDay(todayDay?.day || firstActive?.day || null)
  }, [schedule])

  // Load completions
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

  // ── Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = window.L
    if (!L || !mapRef.current || mapInstance.current) return
    const map = L.map(mapRef.current, { zoomControl: false })
    mapInstance.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.setView([46.6, 2.3], 6)
    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current)
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  // ── Redraw route when day or completions change ───────────────────────────
  useEffect(() => {
    const L = window.L; const map = mapInstance.current
    if (!L || !map || !currentDay) return
    markersRef.current.forEach((m) => map.removeLayer(m)); markersRef.current = []
    if (polylineRef.current) { map.removeLayer(polylineRef.current); polylineRef.current = null }
    const bounds = [], routePoints = []

    const startLat = dayConfig.start_lat ?? therapist?.default_start_lat
    const startLng = dayConfig.start_lng ?? therapist?.default_start_lng
    if (startLat && startLng) {
      const m = L.marker([startLat, startLng], {
        icon: L.divIcon({ className: '', html: '<div class="map-marker map-marker--start">D</div>', iconSize: [32,32], iconAnchor: [16,16] })
      }).addTo(map).bindPopup('Départ')
      markersRef.current.push(m); bounds.push([startLat, startLng]); routePoints.push([startLat, startLng])
    }

    visits.forEach((v, i) => {
      if (!v.lat || !v.lng) return
      const isDone = !!completions[`${v.patient_id}|${currentDay.date}`]?.done
      const isNext = !isDone && v === nextVisit
      const color = isDone ? '#22c55e' : isNext ? '#f59e0b' : getColor(v.patient_name)
      const m = L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="map-marker map-marker--visit nav-marker ${isDone ? 'nav-marker--done' : ''} ${isNext ? 'nav-marker--next' : ''}" style="background:${color}">${isDone ? '✓' : i+1}</div>`,
          iconSize: [36,36], iconAnchor: [18,18],
        })
      }).addTo(map)
        .bindPopup(`<strong>${v.patient_name}</strong><br>${v.start_time}–${v.end_time}<br><small>${v.address}</small>`)
      markersRef.current.push(m); bounds.push([v.lat, v.lng]); routePoints.push([v.lat, v.lng])
    })

    const endLat = dayConfig.end_lat ?? therapist?.default_end_lat
    const endLng = dayConfig.end_lng ?? therapist?.default_end_lng
    if (endLat && endLng) {
      const m = L.marker([endLat, endLng], {
        icon: L.divIcon({ className: '', html: '<div class="map-marker map-marker--end">A</div>', iconSize: [32,32], iconAnchor: [16,16] })
      }).addTo(map).bindPopup('Arrivée')
      markersRef.current.push(m); bounds.push([endLat, endLng]); routePoints.push([endLat, endLng])
    }

    if (routePoints.length > 1)
      polylineRef.current = L.polyline(routePoints, { color:'#184f3b', weight:3, opacity:.7, dashArray:'8,5' }).addTo(map)
    if (bounds.length > 0)
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] })
  }, [selectedDay, completions, visits.length])

  // ── GPS auto-start ────────────────────────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('denied'); return }
    const L = window.L; const map = mapInstance.current
    if (!L || !map) return
    setGpsStatus('starting')
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setPosition({ lat, lng }); setAccuracy(Math.round(acc)); setGpsStatus('active')
        const icon = L.divIcon({ className: '', iconSize: [40,40], iconAnchor: [20,20],
          html: `<div class="user-marker"><div class="user-marker-dot"></div><div class="user-marker-ring"></div></div>` })
        if (userMarker.current) { userMarker.current.setLatLng([lat, lng]); userMarker.current.setIcon(icon) }
        else userMarker.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map)
        if (accuracyCircle.current) map.removeLayer(accuracyCircle.current)
        accuracyCircle.current = L.circle([lat, lng], { radius: acc, color:'#2563eb', fillColor:'#93c5fd', fillOpacity:.15, weight:1 }).addTo(map)
      },
      (err) => {
        setGpsStatus(err.code === 1 ? 'denied' : 'idle')
        if (err.code !== 1) toast.warning('GPS indisponible')
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    )
  }, [toast])

  // Auto-start GPS on mount
  useEffect(() => {
    startTracking()
    return () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current) }
  }, [])

  function centerOnUser() {
    if (position && mapInstance.current) mapInstance.current.setView([position.lat, position.lng], 17, { animate: true })
  }
  function centerOnNext() {
    if (nextVisit?.lat && nextVisit?.lng && mapInstance.current)
      mapInstance.current.setView([nextVisit.lat, nextVisit.lng], 16, { animate: true })
  }

  async function markDone(visit) {
    try {
      const updated = await api.upsertCompletion({ patient_id: visit.patient_id, visit_date: currentDay.date, done: true })
      setCompletions((prev) => ({ ...prev, [`${visit.patient_id}|${currentDay.date}`]: updated }))
      toast.success(`${visit.patient_name} — séance effectuée ✓`)
    } catch { toast.error('Erreur réseau') }
  }
  async function markUndone(visit) {
    try {
      const updated = await api.upsertCompletion({ patient_id: visit.patient_id, visit_date: currentDay.date, done: false })
      setCompletions((prev) => ({ ...prev, [`${visit.patient_id}|${currentDay.date}`]: updated }))
    } catch { toast.error('Erreur réseau') }
  }

  const activeDays = schedule?.days?.filter((d) => d.visits.length > 0) || []
  const distToNext = position && nextVisit?.lat ? haversineKm(position.lat, position.lng, nextVisit.lat, nextVisit.lng) : null
  const isArrived = distToNext !== null && distToNext < 0.15

  if (!schedule) {
    return (
      <div className="nav-page-empty">
        <div style={{ fontSize: 64, marginBottom: 16 }}>🧭</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Aucune tournée générée</div>
        <div className="small muted" style={{ marginBottom: 16 }}>Générez d'abord une tournée depuis l'onglet Planning.</div>
        {onGoToPlanning && <button className="primary" onClick={onGoToPlanning}>⚡ Aller au Planning</button>}
      </div>
    )
  }

  // Visites sans coordonnées GPS
  const allVisits = schedule.days?.flatMap((d) => d.visits) || []
  const missingGps = allVisits.filter((v) => !v.lat || !v.lng)
  const missingGpsBanner = missingGps.length > 0

  return (
    <div className="nav-page">

      {/* ── Bannière GPS manquant ───────────────────────────────────────────── */}
      {missingGpsBanner && (
        <div className="nav-stale-banner">
          <div>
            <strong>📍 {missingGps.length} patient(s) sans coordonnées GPS</strong>
            <div className="small" style={{ marginTop: 2 }}>
              Allez dans Patients → "📍 Tout géolocaliser", puis régénérez la tournée.
            </div>
          </div>
          {onGoToPlanning && (
            <button className="secondary small-btn" style={{ flexShrink: 0 }} onClick={onGoToPlanning}>
              ⚡ Régénérer
            </button>
          )}
        </div>
      )}

      {/* ── 1. Sélecteur de jour ────────────────────────────────────────────── */}
      <div className="nav-day-tabs">
        {activeDays.map((d) => (
          <button key={d.day}
            className={`nav-day-tab ${selectedDay === d.day ? 'nav-day-tab--active' : ''}`}
            onClick={() => setSelectedDay(d.day)}>
            {new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
            <span className="nav-day-count">{d.visits.length}</span>
          </button>
        ))}
      </div>

      {/* ── 2. Carte "prochain patient" (toujours visible) ──────────────────── */}
      {currentDay && (
        <div className={`nav-hero-card ${isArrived ? 'nav-hero-card--arrived' : ''}`}>

          {/* GPS status pill */}
          <div className="nav-hero-top">
            <div className="nav-gps-pill">
              <span className={`nav-gps-dot ${gpsStatus === 'active' ? 'nav-gps-dot--active' : gpsStatus === 'starting' ? 'nav-gps-dot--starting' : 'nav-gps-dot--off'}`} />
              {gpsStatus === 'active' && accuracy ? `GPS ±${accuracy}m` : gpsStatus === 'starting' ? 'Localisation…' : gpsStatus === 'denied' ? 'GPS refusé' : 'GPS inactif'}
            </div>
            <span className="small muted">{doneCount}/{visits.length} effectuées</span>
          </div>

          {nextVisit ? (
            <>
              {isArrived && (
                <div className="nav-arrived-banner">📍 Vous êtes arrivé !</div>
              )}
              <div className="nav-hero-name">
                <div className="nav-hero-num" style={{ background: getColor(nextVisit.patient_name) }}>
                  {visits.indexOf(nextVisit) + 1}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{nextVisit.patient_name}</div>
                  <div className="small muted">{nextVisit.start_time} – {nextVisit.end_time} · {nextVisit.session_duration_min} min</div>
                  <div className="small muted">{nextVisit.address}</div>
                  {distToNext !== null && (
                    <div style={{ fontWeight: 700, color: isArrived ? '#16a34a' : 'var(--green)', fontSize: 13, marginTop: 2 }}>
                      {isArrived ? '✓ Sur place' : `~${distToNext < 1 ? Math.round(distToNext*1000)+'m' : distToNext.toFixed(1)+'km'}`}
                    </div>
                  )}
                </div>
              </div>

              <div className="nav-hero-actions">
                {nextVisit.lat && nextVisit.lng && (
                  <>
                    <button className="nav-btn-maps" onClick={() => navigateTo(nextVisit.lat, nextVisit.lng)}>
                      🗺 Google Maps
                    </button>
                    <button className="nav-btn-waze" onClick={() => navigateWaze(nextVisit.lat, nextVisit.lng)}>
                      🚗 Waze
                    </button>
                  </>
                )}
                <button className="nav-btn-done" onClick={() => markDone(nextVisit)}>
                  ✓ Séance faite
                </button>
              </div>
            </>
          ) : (
            <div className="nav-done-banner">🎉 Tournée terminée ! Bravo.</div>
          )}
        </div>
      )}

      {/* ── 3. Carte Leaflet ────────────────────────────────────────────────── */}
      <div className="nav-map-container">
        <div ref={mapRef} className="nav-map" />
        <div className="nav-map-controls">
          {position && <button className="nav-control-btn" onClick={centerOnUser} title="Ma position">🎯</button>}
          {nextVisit?.lat && <button className="nav-control-btn" onClick={centerOnNext} title="Centrer sur le prochain">▶</button>}
          {visits.some((v) => v.lat && v.lng) && (
            <button className="nav-control-btn" title="Tournée complète dans Maps"
              onClick={() => launchFullRoute(visits,
                dayConfig.start_lat ?? therapist?.default_start_lat,
                dayConfig.start_lng ?? therapist?.default_start_lng,
                dayConfig.end_lat ?? therapist?.default_end_lat,
                dayConfig.end_lng ?? therapist?.default_end_lng)}>
              🚀
            </button>
          )}
        </div>
        {gpsStatus === 'denied' && (
          <div className="nav-gps-denied">
            GPS refusé — autorisez la localisation dans les réglages du navigateur
          </div>
        )}
      </div>

      {/* ── 4. Liste dépliable ──────────────────────────────────────────────── */}
      {currentDay && visits.length > 0 && (
        <div className="nav-list-section">
          <button className="nav-list-toggle" onClick={() => setShowList((v) => !v)}>
            {showList ? '▼' : '▲'} Toutes les visites ({visits.length})
          </button>
          {showList && (
            <div className="nav-visits-list">
              {visits.map((v, i) => {
                const isDone = !!completions[`${v.patient_id}|${currentDay.date}`]?.done
                return (
                  <div key={`${v.patient_id}-${v.start_time}`} className={`nav-visit-item ${isDone ? 'nav-visit-item--done' : ''}`}>
                    <div className="nav-visit-num" style={{ background: isDone ? '#22c55e' : getColor(v.patient_name) }}>
                      {isDone ? '✓' : i+1}
                    </div>
                    <div className="nav-visit-info">
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{v.patient_name}</div>
                      <div className="small muted">{v.start_time} · {v.session_duration_min} min</div>
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      {v.lat && v.lng && <button className="btn-gps" onClick={() => navigateTo(v.lat, v.lng)}>🗺</button>}
                      {isDone
                        ? <button className="secondary small-btn" onClick={() => markUndone(v)}>↩</button>
                        : <button className="primary small-btn" onClick={() => markDone(v)}>✓</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
