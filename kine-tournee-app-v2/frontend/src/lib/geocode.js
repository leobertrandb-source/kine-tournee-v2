/**
 * Géocodage via Nominatim (OpenStreetMap) — gratuit, sans clé API.
 * Retourne { lat, lng, display } ou null.
 */
export async function geocodeAddress(address) {
  if (!address || address.trim().length < 5) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=3&countrycodes=fr&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'fr', 'User-Agent': 'KineTournee/2.0' },
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    if (!data.length) return null
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      display: data[0].display_name,
      suggestions: data.map((d) => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        display: d.display_name,
      })),
    }
  } catch {
    return null
  }
}
