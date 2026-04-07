import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { geocodeAddress, autocompleteAddress } from '../lib/geocode'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { SkeletonPatient } from '../components/Skeleton'

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS = { monday: 'Lun', tuesday: 'Mar', wednesday: 'Mer', thursday: 'Jeu', friday: 'Ven', saturday: 'Sam', sunday: 'Dim' }

const PATIENT_COLORS = ['#184f3b','#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#9333ea']
function getColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return PATIENT_COLORS[Math.abs(h) % PATIENT_COLORS.length]
}
function Avatar({ name, size = 40 }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return <div className="avatar" style={{ width: size, height: size, background: getColor(name), fontSize: size * 0.38 }}>{initials}</div>
}

const EMPTY = {
  full_name: '', address: '', lat: '', lng: '', phone: '', email: '', doctor_name: '',
  prescription_sessions_total: '', prescription_sessions_done: 0,
  session_duration_min: 30, sessions_per_week: 2, is_fixed: false, active: true,
  notes: '', availability: {},
}

function AddressAutocomplete({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [imprecise, setImprecise] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
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
        required
        placeholder="3 rue de la Paix, 75001 Paris"
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
          ⚠️ Numéro de rue introuvable — position approximative à la rue. Vérifiez les coordonnées.
        </div>
      )}
    </div>
  )
}

function BlockedWindowEditor({ windows, onChange }) {
  const [ns, setNs] = useState('08:00')
  const [ne, setNe] = useState('12:00')
  return (
    <div className="time-windows">
      <div className="time-windows-list">
        {(windows ?? []).map((w, i) => (
          <span key={i} className="time-badge badge-red">
            {w.start_time}–{w.end_time}
            <button className="badge-remove" onClick={() => onChange(windows.filter((_, idx) => idx !== i))}>×</button>
          </span>
        ))}
        {(!windows || windows.length === 0) && <span className="small muted">Aucune plage exclue</span>}
      </div>
      <div className="time-window-add">
        <input type="time" value={ns} onChange={(e) => setNs(e.target.value)} />
        <span className="small">→</span>
        <input type="time" value={ne} onChange={(e) => setNe(e.target.value)} />
        <button className="secondary small-btn" onClick={() => { if (ns < ne) onChange([...(windows ?? []), { start_time: ns, end_time: ne }]) }}>+ Exclure</button>
      </div>
    </div>
  )
}

// Indisponibilités patient : par défaut tout est dispo (= horaires du kiné)
// On définit uniquement les jours / plages où le patient n'est PAS joignable
function UnavailabilityEditor({ availability, onChange }) {
  return (
    <div className="avail-grid">
      {DAY_KEYS.map((d) => {
        const day = availability[d] ?? { unavailable: false, blocked_windows: [] }
        return (
          <div key={d} className={`avail-day ${day.unavailable ? 'avail-day--off' : ''}`}>
            <div className="avail-day-header">
              <strong>{DAY_LABELS[d]}</strong>
              <label className="avail-toggle">
                <input type="checkbox" checked={!!day.unavailable}
                  onChange={(e) => onChange({ ...availability, [d]: { ...day, unavailable: e.target.checked } })} />
                Indisponible ce jour
              </label>
            </div>
            {!day.unavailable && (
              <div className="avail-section">
                <div className="small avail-label avail-label--red">Plages horaires exclues</div>
                <BlockedWindowEditor
                  windows={day.blocked_windows ?? []}
                  onChange={(w) => onChange({ ...availability, [d]: { ...day, blocked_windows: w } })}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AbsenceManager({ patientId, absences, setAbsences }) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  async function add() {
    if (!date) return
    setSaving(true)
    try {
      const a = await api.addAbsence(patientId, { absence_date: date, reason })
      setAbsences((prev) => [...prev.filter((x) => x.absence_date !== date), a])
      setDate(''); setReason('')
      toast.success('Absence enregistrée')
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  async function remove(d) {
    await api.deleteAbsence(patientId, d)
    setAbsences((prev) => prev.filter((x) => x.absence_date !== d))
    toast.info('Absence supprimée')
  }

  return (
    <div className="absence-manager">
      <div className="small muted" style={{ marginBottom: 6 }}>Absences ponctuelles (le patient ne sera pas planifié ces jours)</div>
      <div className="absence-list">
        {absences.map((a) => (
          <span key={a.absence_date} className="time-badge badge-orange">
            {a.absence_date}{a.reason ? ` — ${a.reason}` : ''}
            <button className="badge-remove" onClick={() => remove(a.absence_date)}>×</button>
          </span>
        ))}
        {absences.length === 0 && <span className="small muted">Aucune absence</span>}
      </div>
      <div className="time-window-add" style={{ marginTop: 6 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="Motif (optionnel)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
        <button className="secondary small-btn" onClick={add} disabled={saving || !date}>{saving ? '…' : '+ Ajouter'}</button>
      </div>
    </div>
  )
}

export default function PatientsPage({ patients, setPatients }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [showAvail, setShowAvail] = useState(false)
  const [absences, setAbsences] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModal, setDeleteModal] = useState(null)
  const [geocodingAll, setGeocodingAll] = useState(false)

  function setField(key, value) { setForm((prev) => ({ ...prev, [key]: value })) }

  async function geocodeAll() {
    const missing = patients.filter((p) => p.active && p.address && (!p.lat || !p.lng))
    if (!missing.length) { toast.info('Tous les patients ont déjà des coordonnées GPS'); return }
    setGeocodingAll(true)
    toast.info(`Géolocalisation de ${missing.length} patient(s)…`)
    let ok = 0
    for (const p of missing) {
      const result = await geocodeAddress(p.address)
      if (result) {
        try {
          const updated = await api.updatePatient(p.id, { lat: result.lat, lng: result.lng })
          setPatients((prev) => prev.map((x) => x.id === p.id ? updated : x))
          ok++
        } catch { /* continue */ }
      }
      await new Promise((r) => setTimeout(r, 1100)) // respecter le rate-limit Nominatim (1 req/s)
    }
    setGeocodingAll(false)
    toast.success(`${ok}/${missing.length} patient(s) géolocalisé(s)`)
  }

  async function handleGeocode() {
    if (!form.address) return
    setGeocoding(true)
    try {
      const result = await geocodeAddress(form.address)
      if (result) {
        setField('lat', result.lat)
        setField('lng', result.lng)
        toast.success('Coordonnées trouvées ✓')
      } else {
        toast.warning('Adresse introuvable — vérifiez l\'adresse')
      }
    } finally { setGeocoding(false) }
  }

  async function startEdit(patient) {
    setEditingId(patient.id)
    setForm({ ...EMPTY, ...patient, lat: patient.lat ?? '', lng: patient.lng ?? '', availability: patient.availability ?? {} })
    setShowAvail(false)
    try { setAbsences(await api.getPatientAbsences(patient.id)) } catch { setAbsences([]) }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() { setEditingId(null); setForm(EMPTY); setAbsences([]); setShowAvail(false) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      let lat = form.lat === '' ? null : Number(form.lat)
      let lng = form.lng === '' ? null : Number(form.lng)

      // Auto-géolocaliser si l'adresse est renseignée mais les coordonnées manquent
      if (form.address && (!lat || !lng)) {
        toast.info('Géolocalisation automatique…')
        const result = await geocodeAddress(form.address)
        if (result) { lat = result.lat; lng = result.lng; toast.success('Adresse géolocalisée ✓') }
        else toast.warning('Adresse introuvable — le patient sera ajouté sans coordonnées GPS')
      }

      const payload = {
        ...form, lat, lng,
        prescription_sessions_total: form.prescription_sessions_total === '' ? null : Number(form.prescription_sessions_total),
        prescription_sessions_done: Number(form.prescription_sessions_done || 0),
      }
      if (editingId) {
        const updated = await api.updatePatient(editingId, payload)
        setPatients((prev) => prev.map((p) => p.id === editingId ? updated : p))
        toast.success('Patient mis à jour')
        cancelEdit()
      } else {
        const created = await api.createPatient(payload)
        setPatients((prev) => [created, ...prev])
        toast.success('Patient ajouté')
        setForm(EMPTY)
      }
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    try {
      await api.deletePatient(id)
      setPatients((prev) => prev.filter((p) => p.id !== id))
      if (editingId === id) cancelEdit()
      toast.success('Patient supprimé')
    } catch (err) { toast.error(err.message) }
    setDeleteModal(null)
  }

  async function toggleActive(patient) {
    try {
      const updated = await api.updatePatient(patient.id, { active: !patient.active })
      setPatients((prev) => prev.map((p) => p.id === patient.id ? updated : p))
      toast.info(updated.active ? 'Patient activé' : 'Patient désactivé')
    } catch (err) { toast.error(err.message) }
  }

  const filtered = patients.filter((p) =>
    (p.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.address || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const prescriptionAlert = (p) => {
    if (!p.prescription_sessions_total) return null
    const remaining = p.prescription_sessions_total - (p.prescription_sessions_done ?? 0)
    if (remaining <= 3) return remaining <= 0 ? 'épuisé' : `⚠ ${remaining} restante(s)`
    return null
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Modal open={!!deleteModal} title="Supprimer le patient" danger
        message={`Supprimer définitivement ${deleteModal?.name} ? Cette action est irréversible.`}
        confirmLabel="Supprimer" onConfirm={() => handleDelete(deleteModal.id)} onCancel={() => setDeleteModal(null)} />

      {/* Formulaire */}
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{editingId ? 'Modifier' : 'Nouveau patient'}</h2>
          {editingId && <button className="secondary small-btn" onClick={cancelEdit}>Annuler</button>}
        </div>
        <form className="grid" onSubmit={handleSave}>
          <div className="grid grid-2">
            <label>Nom complet *<input value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} required /></label>
            <label>Téléphone<input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="06 XX XX XX XX" /></label>
          </div>
          <label>Email (pour les notifications)
            <input type="email" value={form.email || ''} onChange={(e) => setField('email', e.target.value)} placeholder="patient@email.fr" />
          </label>
          <label>Adresse *
            <AddressAutocomplete
              value={form.address}
              onChange={(address) => setField('address', address)}
              onSelect={(suggestion) => {
                setField('address', suggestion.display)
                setField('lat', suggestion.lat)
                setField('lng', suggestion.lng)
              }}
            />
          </label>
          <div className="grid grid-2">
            <label>Latitude<input value={form.lat} onChange={(e) => setField('lat', e.target.value)} placeholder="48.8566" /></label>
            <label>Longitude<input value={form.lng} onChange={(e) => setField('lng', e.target.value)} placeholder="2.3522" /></label>
          </div>
          <div className="grid grid-2">
            <label>Médecin prescripteur<input value={form.doctor_name} onChange={(e) => setField('doctor_name', e.target.value)} /></label>
            <label>Séances prescrites<input type="number" min="0" value={form.prescription_sessions_total} onChange={(e) => setField('prescription_sessions_total', e.target.value)} placeholder="ex: 30" /></label>
          </div>
          {editingId && (
            <label>Séances effectuées<input type="number" min="0" value={form.prescription_sessions_done} onChange={(e) => setField('prescription_sessions_done', e.target.value)} /></label>
          )}
          <div className="grid grid-2">
            <label>Durée séance (min)<input type="number" min="5" max="120" value={form.session_duration_min} onChange={(e) => setField('session_duration_min', Number(e.target.value))} /></label>
            <label>Séances / semaine<input type="number" min="1" max="14" value={form.sessions_per_week} onChange={(e) => setField('sessions_per_week', Number(e.target.value))} /></label>
          </div>
          <div className="row">
            <label className="checkbox-label"><input type="checkbox" checked={form.is_fixed} onChange={(e) => setField('is_fixed', e.target.checked)} />Créneau fixe</label>
            <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={(e) => setField('active', e.target.checked)} />Actif</label>
          </div>
          <label>Notes<textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Pathologie, accès, code porte…" /></label>
          <button type="button" className="secondary" onClick={() => setShowAvail((v) => !v)} style={{ width: '100%' }}>
            {showAvail ? '▲ Masquer indisponibilités' : '▼ Indisponibilités du patient'}
          </button>
          {showAvail && <UnavailabilityEditor availability={form.availability} onChange={(a) => setField('availability', a)} />}
          {editingId && <AbsenceManager patientId={editingId} absences={absences} setAbsences={setAbsences} />}
          <button className="primary" disabled={saving}>{saving ? 'Enregistrement…' : editingId ? 'Mettre à jour' : 'Ajouter le patient'}</button>
        </form>
      </div>

      {/* Liste */}
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Patients ({filtered.length})</h2>
          <div className="row" style={{ gap: 6 }}>
            <input placeholder="Rechercher…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: 140 }} />
            <button className="secondary small-btn" onClick={geocodeAll} disabled={geocodingAll} title="Géolocaliser les patients sans coordonnées GPS">
              {geocodingAll ? '…' : '📍 Tout géolocaliser'}
            </button>
          </div>
        </div>
        <div className="patient-list">
          {filtered.map((p) => {
            const alert = prescriptionAlert(p)
            return (
              <div key={p.id} className={`patient-card ${editingId === p.id ? 'patient-card--editing' : ''} ${!p.active ? 'patient-card--inactive' : ''}`}>
                <div className="patient-card-header">
                  <Avatar name={p.full_name || '?'} size={40} />
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong>{p.full_name}</strong>
                      {p.is_fixed && <span className="badge badge-fixed badge-xs">Fixe</span>}
                      {!p.active && <span className="badge badge-inactive badge-xs">Inactif</span>}
                      {alert && <span className={`badge badge-xs ${alert === 'épuisé' ? 'badge-red' : 'badge-orange'}`}>{alert}</span>}
                      {(!p.lat || !p.lng) && <span className="badge badge-xs badge-orange" title="Pas de coordonnées GPS — invisible sur la carte">📍 sans GPS</span>}
                    </div>
                    <div className="small muted">{p.address}</div>
                    {p.phone && <div className="small muted">{p.phone}</div>}
                    {p.doctor_name && <div className="small muted">Dr {p.doctor_name}</div>}
                    <div className="small muted">{p.sessions_per_week}×/semaine · {p.session_duration_min} min
                      {p.prescription_sessions_total ? ` · ${p.prescription_sessions_done ?? 0}/${p.prescription_sessions_total} séances` : ''}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                    <button className="secondary small-btn" onClick={() => startEdit(p)} title="Modifier">✏</button>
                    <button className="secondary small-btn" onClick={() => toggleActive(p)} title={p.active ? 'Désactiver' : 'Activer'}>{p.active ? '⏸' : '▶'}</button>
                    <button className="secondary small-btn danger" onClick={() => setDeleteModal({ id: p.id, name: p.full_name })} title="Supprimer">🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="empty-state">Aucun patient trouvé</div>}
        </div>
      </div>
    </div>
  )
}
