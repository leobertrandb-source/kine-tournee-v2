/**
 * Géocodage via api.adresse.data.gouv.fr (Base Adresse Nationale)
 * Gratuit, sans clé API, très précis pour les adresses françaises.
 */
const BAN = 'https://api-adresse.data.gouv.fr'

const TYPE_LABEL = {
  housenumber: { label: 'Numéro exact', precise: true },
  street:      { label: 'Rue (numéro non trouvé)', precise: false },
  locality:    { label: 'Lieu-dit', precise: false },
  municipality:{ label: 'Commune', precise: false },
}

function mapFeature(f) {
  const type = f.properties.type ?? 'street'
  return {
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    display: f.properties.label,
    type,
    precise: TYPE_LABEL[type]?.precise ?? false,
    typeLabel: TYPE_LABEL[type]?.label ?? type,
    score: f.properties.score ?? 0,
  }
}

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
      ...mapFeature(best),
      suggestions: features.map(mapFeature),
    }
  } catch {
    return null
  }
}

/**
 * Autocomplétion d'adresse — retourne une liste de suggestions avec niveau de précision.
 * À appeler avec un debounce (ex: 300ms).
 */
export async function autocompleteAddress(query) {
  if (!query || query.trim().length < 3) return []
  try {
    const url = `${BAN}/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    return (data.features ?? []).map(mapFeature)
  } catch {
    return []
  }
}
