import { useState, useEffect, useRef } from 'react'
import { autocompleteAddress } from '../lib/geocode'

/**
 * Champ adresse avec autocomplétion BAN (Base Adresse Nationale).
 *
 * Props :
 *   value      – valeur actuelle (string)
 *   onChange   – appelé quand l'utilisateur tape (string)
 *   onSelect   – appelé quand une suggestion est choisie ({ display, lat, lng, precise, typeLabel })
 *   placeholder – texte placeholder
 *   required
 */
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, required }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [imprecise, setImprecise] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleChange(e) {
    const q = e.target.value
    onChange(q)
    setImprecise(false)
    clearTimeout(timerRef.current)
    if (q.length < 3) { setSuggestions([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      const results = await autocompleteAddress(q)
      setSuggestions(results)
      setOpen(results.length > 0)
    }, 300)
  }

  function handleSelect(s) {
    onSelect(s)
    setSuggestions([])
    setOpen(false)
    setImprecise(!s.precise)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        required={required}
        placeholder={placeholder || '3 rue de la Paix, 75001 Paris'}
        autoComplete="off"
      />
      {open && (
        <ul className="address-suggestions">
          {suggestions.map((s, i) => (
            <li key={i} className="address-suggestion-item" onMouseDown={() => handleSelect(s)}>
              <span>{s.display}</span>
              <span className={`address-suggestion-type ${s.precise ? 'address-suggestion-type--ok' : 'address-suggestion-type--approx'}`}>
                {s.typeLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
      {imprecise && (
        <div className="address-imprecise-warn">
          ⚠️ Numéro introuvable — position approximative. Vérifiez les coordonnées.
        </div>
      )}
    </div>
  )
}
