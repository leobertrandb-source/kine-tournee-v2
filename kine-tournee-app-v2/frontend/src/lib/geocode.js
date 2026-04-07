/**
 * Géocodage via api.adresse.data.gouv.fr (Base Adresse Nationale)
 * Gratuit, sans clé API, très précis pour les adresses françaises.
 */
const BAN = 'https://api-adresse.data.gouv.fr'

export async function geocodeAddress(address) {
  if (!address || address.trim().length < 5) return null
  try {
    const url = `${BAN}/search/?q=${encodeURIComponent(address)}&limit=5&autocomplete=0`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    const features = data.features ?? []
    if (!features.length) return null
    const best = features[0]
    return {
      lat: best.geometry.coordinates[1],
      lng: best.geometry.coordinates[0],
      display: best.properties.label,
      suggestions: features.map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        display: f.properties.label,
      })),
    }
  } catch {
    return null
  }
}

/**
 * Autocomplétion d'adresse — retourne une liste de suggestions
 * à appeler avec un debounce (ex: 300ms).
 */
export async function autocompleteAddress(query) {
  if (!query || query.trim().length < 3) return []
  try {
    const url = `${BAN}/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    return (data.features ?? []).map((f) => ({
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      display: f.properties.label,
    }))
  } catch {
    return []
  }
}
