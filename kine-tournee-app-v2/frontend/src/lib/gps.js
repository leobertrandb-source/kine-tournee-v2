/**
 * Utilitaires GPS — navigation vers les visites.
 */

/** Ouvre Google Maps vers une destination */
export function navigateTo(lat, lng, label = '') {
  const dest = `${lat},${lng}`
  const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`
  window.open(url, '_blank', 'noopener')
}

/** Ouvre Waze vers une destination */
export function navigateWaze(lat, lng) {
  window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank', 'noopener')
}

/**
 * Ouvre Google Maps avec toute la tournée du jour (waypoints).
 * Limite : Google Maps accepte jusqu'à 10 waypoints.
 */
export function launchFullRoute(visits, startLat, startLng, endLat, endLng) {
  const validVisits = visits.filter((v) => v.lat && v.lng)
  if (!validVisits.length) return

  const origin = startLat && startLng ? `${startLat},${startLng}` : ''
  const destination = endLat && endLng
    ? `${endLat},${endLng}`
    : `${validVisits[validVisits.length - 1].lat},${validVisits[validVisits.length - 1].lng}`

  const waypoints = validVisits
    .slice(0, endLat ? validVisits.length : validVisits.length - 1)
    .slice(0, 9) // max 9 waypoints Google Maps
    .map((v) => `${v.lat},${v.lng}`)
    .join('|')

  let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
  if (origin) url += `&origin=${origin}`
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`

  window.open(url, '_blank', 'noopener')
}

/** Récupère la position actuelle du navigateur */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non supportée'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}
