/**
 * Géocodage combiné :
 *  - BAN (api.adresse.data.gouv.fr) pour les adresses postales françaises
 *  - Photon (photon.komoot.io) pour les enseignes / POI (cabinets, pharmacies…)
 * Gratuit, sans clé API.
 */
const BAN    = 'https://api-adresse.data.gouv.fr'
const PHOTON = 'https://photon.komoot.io/api'

const BAN_TYPE_LABEL = {
  housenumber:  { label: 'Adresse exacte',           precise: true  },
  street:       { label: 'Rue (n° introuvable)',      precise: false },
  locality:     { label: 'Lieu-dit',                  precise: false },
  municipality: { label: 'Commune',                   precise: false },
}

function mapBan(f) {
  const type = f.properties.type ?? 'street'
  return {
    lat:       f.geometry.coordinates[1],
    lng:       f.geometry.coordinates[0],
    display:   f.properties.label,
    type,
    precise:   BAN_TYPE_LABEL[type]?.precise ?? false,
    typeLabel: BAN_TYPE_LABEL[type]?.label ?? type,
    source:    'ban',
  }
}

function mapPhoton(f) {
  const p = f.properties
  // Construire un libellé lisible : Nom, numéro rue, ville
  const parts = [p.name, p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city].filter(Boolean)
  const display = parts.join(', ')
  return {
    lat:       f.geometry.coordinates[1],
    lng:       f.geometry.coordinates[0],
    display,
    type:      'poi',
    precise:   true,
    typeLabel: p.osm_value ?? 'Enseigne',
    source:    'photon',
  }
}

async function fetchBan(query, autocomplete = true, limit = 5) {
  try {
    const url = `${BAN}/search/?q=${encodeURIComponent(query)}&limit=${limit}&autocomplete=${autocomplete ? 1 : 0}`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    return (data.features ?? []).map(mapBan)
  } catch { return [] }
}

async function fetchPhoton(query, limit = 4) {
  try {
    const url = `${PHOTON}/?q=${encodeURIComponent(query)}&limit=${limit}&lang=fr&bbox=-5.2,41.3,9.6,51.1`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    return (data.features ?? [])
      .filter((f) => f.properties.name && f.properties.country === 'France')
      .map(mapPhoton)
  } catch { return [] }
}

/** Déduplique par proximité géographique (~50m) */
function dedup(results) {
  const seen = []
  return results.filter((r) => {
    const dupe = seen.some((s) => Math.abs(s.lat - r.lat) < 0.0005 && Math.abs(s.lng - r.lng) < 0.0005)
    if (!dupe) seen.push(r)
    return !dupe
  })
}

/**
 * Autocomplétion combinée adresse + enseigne.
 * Appeler avec un debounce de 300ms.
 */
export async function autocompleteAddress(query) {
  if (!query || query.trim().length < 3) return []
  const [ban, photon] = await Promise.all([fetchBan(query, true, 5), fetchPhoton(query, 4)])
  // Adresses BAN en premier, enseignes Photon ensuite (si pas déjà dans BAN)
  return dedup([...ban, ...photon]).slice(0, 8)
}

/**
 * Géocode une adresse (sans autocomplétion).
 */
export async function geocodeAddress(address) {
  if (!address || address.trim().length < 5) return null
  const [ban, photon] = await Promise.all([fetchBan(address, false, 3), fetchPhoton(address, 2)])
  const all = dedup([...ban, ...photon])
  if (!all.length) return null
  return { ...all[0], suggestions: all }
}
