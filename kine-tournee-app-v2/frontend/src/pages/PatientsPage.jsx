import { useState } from 'react'
import { api } from '../lib/api'

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
}

function makeDefaultAvailability() {
  return Object.fromEntries(
    DAY_KEYS.map((d) => [
      d,
      {
        unavailable: d === 'saturday' || d === 'sunday',
        available_windows: [],
        blocked_windows: [],
      },
    ])
  )
}

const EMPTY = {
  full_name: '',
  address: '',
  lat: '',
  lng: '',
  phone: '',
  doctor_name: '',
  prescription_sessions_total: '',
  prescription_sessions_done: 0,
  session_duration_min: 30,
  sessions_per_week: 2,
  is_fixed: false,
  active: true,
  notes: '',
  availability: makeDefaultAvailability(),
}

// ── Éditeur de fenêtres horaires ──────────────────────────────────────────────
function TimeWindowEditor({ windows, onChange, colorClass }) {
  const [newStart, setNewStart] = useState('08:00')
  const [newEnd, setNewEnd] = useState('12:00')

  function add() {
    if (newStart >= newEnd) return
    onChange([...windows, { start_time: newStart, end_time: newEnd }])
  }
  function remove(i) {
    onChange(windows.filter((_, idx) => idx !== i))
  }

  return (
    <div className="time-windows">
      <div className="time-windows-list">
        {windows.map((w, i) => (
          <span key={i} className={`time-badge ${colorClass}`}>
            {w.start_time}–{w.end_time}
            <button className="badge-remove" onClick={() => remove(i)}>×</button>
          </span>
        ))}
        {windows.length === 0 && <span className="small muted">Aucune</span>}
      </div>
      <div className="time-window-add">
        <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
        <span className="small">→</span>
        <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
        <button className="secondary small-btn" onClick={add}>+ Ajouter</button>
      </div>
    </div>
  )
}

// ── Éditeur de disponibilités par jour ────────────────────────────────────────
function AvailabilityEditor({ availability, onChange }) {
  function updateDay(dayKey, patch) {
    onChange({ ...availability, [dayKey]: { ...availability[dayKey], ...patch } })
  }

  return (
    <div className="avail-grid">
      {DAY_KEYS.map((d) => {
        const day = availability[d] ?? { unavailable: false, available_windows: [], blocked_windows: [] }
        return (
          <div key={d} className={`avail-day ${day.unavailable ? 'avail-day--off' : ''}`}>
            <div className="avail-day-header">
              <strong>{DAY_LABELS[d]}</strong>
              <label className="avail-toggle">
                <input
                  type="checkbox"
                  checked={!day.unavailable}
                  onChange={(e) => updateDay(d, { unavailable: !e.target.checked })}
                />
                Disponible
              </label>
            </div>
            {!day.unavailable && (
              <>
                <div className="avail-section">
                  <div className="small avail-label avail-label--green">Créneaux disponibles</div>
                  <TimeWindowEditor
                    windows={day.available_windows ?? []}
                    onChange={(w) => updateDay(d, { available_windows: w })}
                    colorClass="badge-green"
                  />
                </div>
                <div className="avail-section">
                  <div className="small avail-label avail-label--red">Créneaux bloqués</div>
                  <TimeWindowEditor
                    windows={day.blocked_windows ?? []}
                    onChange={(w) => updateDay(d, { blocked_windows: w })}
                    colorClass="badge-red"
                  />
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Gestion des absences ponctuelles ──────────────────────────────────────────
function AbsenceManager({ patientId, absences, setAbsences }) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!date) return
    setSaving(true)
    try {
      const a = await api.addAbsence(patientId, { absence_date: date, reason })
      setAbsences((prev) => [...prev.filter((x) => x.absence_date !== date), a])
      setDate('')
      setReason('')
    } finally {
      setSaving(false)
    }
  }

  async function remove(absDate) {
    await api.deleteAbsence(patientId, absDate)
    setAbsences((prev) => prev.filter((x) => x.absence_date !== absDate))
  }

  return (
    <div className="absence-manager">
      <div className="small muted" style={{ marginBottom: 6 }}>
        Absences ponctuelles (le patient ne sera pas planifié ces jours)
      </div>
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
        <input
          placeholder="Motif (optionnel)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="secondary small-btn" onClick={add} disabled={saving || !date}>
          {saving ? '…' : '+ Ajouter'}
        </button>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function PatientsPage({ patients, setPatients }) {
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showAvail, setShowAvail] = useState(false)
  const [absences, setAbsences] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function startEdit(patient) {
    setEditingId(patient.id)
    setForm({
      ...EMPTY,
      ...patient,
      lat: patient.lat ?? '',
      lng: patient.lng ?? '',
      availability: patient.availability ?? makeDefaultAvailability(),
    })
    setShowAvail(false)
    setError('')
    // Charger absences
    try {
      const abs = await api.getPatientAbsences(patient.id)
      setAbsences(abs)
    } catch {
      setAbsences([])
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY)
    setAbsences([])
    setShowAvail(false)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        lat: form.lat === '' ? null : Number(form.lat),
        lng: form.lng === '' ? null : Number(form.lng),
        prescription_sessions_total:
          form.prescription_sessions_total === '' ? null : Number(form.prescription_sessions_total),
        prescription_sessions_done: Number(form.prescription_sessions_done || 0),
      }

      if (editingId) {
        const updated = await api.updatePatient(editingId, payload)
        setPatients((prev) => prev.map((p) => (p.id === editingId ? updated : p)))
        cancelEdit()
      } else {
        const created = await api.createPatient(payload)
        setPatients((prev) => [created, ...prev])
        setForm(EMPTY)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce patient ?')) return
    try {
      await api.deletePatient(id)
      setPatients((prev) => prev.filter((p) => p.id !== id))
      if (editingId === id) cancelEdit()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleActive(patient) {
    try {
      const updated = await api.updatePatient(patient.id, { active: !patient.active })
      setPatients((prev) => prev.map((p) => (p.id === patient.id ? updated : p)))
    } catch (err) {
      setError(err.message)
    }
  }

  const filtered = patients.filter(
    (p) =>
      p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const prescriptionAlert = (p) => {
    if (!p.prescription_sessions_total) return null
    const done = p.prescription_sessions_done ?? 0
    const remaining = p.prescription_sessions_total - done
    if (remaining <= 3) return remaining <= 0 ? 'épuisé' : `⚠ ${remaining} restante(s)`
    return null
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      {/* ── Formulaire ─────────────────────────────────────────────────── */}
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{editingId ? 'Modifier le patient' : 'Nouveau patient'}</h2>
          {editingId && (
            <button className="secondary small-btn" onClick={cancelEdit}>Annuler</button>
          )}
        </div>

        {error && <div className="alert-error">{error}</div>}

        <form className="grid" onSubmit={handleSave}>
          {/* Identité */}
          <div className="grid grid-2">
            <label>Nom complet *
              <input value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} required />
            </label>
            <label>Téléphone
              <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="06 XX XX XX XX" />
            </label>
          </div>

          <label>Adresse *
            <input value={form.address} onChange={(e) => setField('address', e.target.value)} required />
          </label>

          <div className="grid grid-2">
            <label>Latitude
              <input value={form.lat} onChange={(e) => setField('lat', e.target.value)} placeholder="48.8566" />
            </label>
            <label>Longitude
              <input value={form.lng} onChange={(e) => setField('lng', e.target.value)} placeholder="2.3522" />
            </label>
          </div>

          {/* Médecin + ordonnance */}
          <div className="grid grid-2">
            <label>Médecin prescripteur
              <input value={form.doctor_name} onChange={(e) => setField('doctor_name', e.target.value)} />
            </label>
            <label>Séances prescrites (total)
              <input
                type="number" min="0"
                value={form.prescription_sessions_total}
                onChange={(e) => setField('prescription_sessions_total', e.target.value)}
                placeholder="ex: 30"
              />
            </label>
          </div>

          {editingId && (
            <label>Séances déjà effectuées
              <input
                type="number" min="0"
                value={form.prescription_sessions_done}
                onChange={(e) => setField('prescription_sessions_done', e.target.value)}
              />
            </label>
          )}

          {/* Planning */}
          <div className="grid grid-2">
            <label>Durée séance (min)
              <input
                type="number" min="5" max="120"
                value={form.session_duration_min}
                onChange={(e) => setField('session_duration_min', Number(e.target.value))}
              />
            </label>
            <label>Séances / semaine
              <input
                type="number" min="1" max="14"
                value={form.sessions_per_week}
                onChange={(e) => setField('sessions_per_week', Number(e.target.value))}
              />
            </label>
          </div>

          <div className="row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_fixed}
                onChange={(e) => setField('is_fixed', e.target.checked)}
              />
              Patient à créneau fixe (priorité haute dans le planning)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setField('active', e.target.checked)}
              />
              Actif
            </label>
          </div>

          <label>Notes
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={2}
              placeholder="Pathologie, accès, code porte…"
            />
          </label>

          {/* Disponibilités */}
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowAvail((v) => !v)}
              style={{ width: '100%' }}
            >
              {showAvail ? '▲ Masquer' : '▼ Disponibilités par jour'}
            </button>
            {showAvail && (
              <div style={{ marginTop: 12 }}>
                <AvailabilityEditor
                  availability={form.availability}
                  onChange={(a) => setField('availability', a)}
                />
              </div>
            )}
          </div>

          {/* Absences (uniquement en mode édition) */}
          {editingId && (
            <AbsenceManager
              patientId={editingId}
              absences={absences}
              setAbsences={setAbsences}
            />
          )}

          <button className="primary" disabled={saving}>
            {saving ? 'Enregistrement…' : editingId ? 'Mettre à jour' : 'Ajouter le patient'}
          </button>
        </form>
      </div>

      {/* ── Liste des patients ─────────────────────────────────────────── */}
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Patients ({filtered.length})</h2>
          <input
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 180 }}
          />
        </div>

        <div className="patient-list">
          {filtered.map((p) => {
            const alert = prescriptionAlert(p)
            return (
              <div
                key={p.id}
                className={`patient-card ${editingId === p.id ? 'patient-card--editing' : ''} ${!p.active ? 'patient-card--inactive' : ''}`}
              >
                <div className="patient-card-header">
                  <div>
                    <div className="row" style={{ gap: 6 }}>
                      <strong>{p.full_name}</strong>
                      {p.is_fixed && <span className="badge badge-fixed">Fixe</span>}
                      {!p.active && <span className="badge badge-inactive">Inactif</span>}
                      {alert && (
                        <span className={`badge ${alert === 'épuisé' ? 'badge-red' : 'badge-orange'}`}>
                          {alert}
                        </span>
                      )}
                    </div>
                    <div className="small muted">{p.address}</div>
                    {p.phone && <div className="small muted">{p.phone}</div>}
                    {p.doctor_name && <div className="small muted">Dr {p.doctor_name}</div>}
                    <div className="small muted">
                      {p.sessions_per_week} séance(s)/semaine · {p.session_duration_min} min
                      {p.prescription_sessions_total
                        ? ` · ${p.prescription_sessions_done ?? 0}/${p.prescription_sessions_total} séances`
                        : ''}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button
                      className="secondary small-btn"
                      onClick={() => startEdit(p)}
                      title="Modifier"
                    >
                      ✏
                    </button>
                    <button
                      className="secondary small-btn"
                      onClick={() => toggleActive(p)}
                      title={p.active ? 'Désactiver' : 'Activer'}
                    >
                      {p.active ? '⏸' : '▶'}
                    </button>
                    <button
                      className="secondary small-btn danger"
                      onClick={() => handleDelete(p.id)}
                      title="Supprimer"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="small muted" style={{ textAlign: 'center', padding: 24 }}>
              Aucun patient trouvé
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
