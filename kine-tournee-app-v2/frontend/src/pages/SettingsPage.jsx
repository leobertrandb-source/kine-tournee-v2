import { useState } from 'react'
import { api } from '../lib/api'
import AddressAutocomplete from '../components/AddressAutocomplete'

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

// ── Éditeur de fenêtres de pause (blocked_windows) ───────────────────────────
function BlockedWindowsEditor({ windows, onChange }) {
  const [newStart, setNewStart] = useState('12:30')
  const [newEnd, setNewEnd] = useState('13:30')

  function add() {
    if (newStart >= newEnd) return
    onChange([...(windows ?? []), { start_time: newStart, end_time: newEnd }])
  }
  function remove(i) {
    onChange((windows ?? []).filter((_, idx) => idx !== i))
  }

  return (
    <div className="blocked-windows-editor">
      <div className="small avail-label avail-label--red" style={{ marginBottom: 6 }}>
        Pauses / indisponibilités
      </div>
      <div className="time-windows-list" style={{ marginBottom: 8 }}>
        {(windows ?? []).map((w, i) => (
          <span key={i} className="time-badge badge-red">
            {w.start_time}–{w.end_time}
            <button className="badge-remove" onClick={() => remove(i)}>×</button>
          </span>
        ))}
        {(!windows || windows.length === 0) && (
          <span className="small muted">Aucune pause configurée</span>
        )}
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

export default function SettingsPage({ therapist, setTherapist, weeklyConfig, setWeeklyConfig }) {
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingDay, setSavingDay] = useState({})
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function saveProfile() {
    setSavingProfile(true)
    setError('')
    setSuccess('')
    try {
      const saved = await api.updateTherapistProfile(therapist)
      setTherapist(saved)
      setSuccess('Profil sauvegardé')
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function saveDay(dayKey) {
    setSavingDay((prev) => ({ ...prev, [dayKey]: true }))
    setError('')
    setSuccess('')
    try {
      const saved = await api.updateDayConfig(dayKey, weeklyConfig[dayKey])
      setWeeklyConfig((prev) => ({ ...prev, [dayKey]: saved }))
      setSuccess(`${DAY_LABELS[dayKey]} sauvegardé`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingDay((prev) => ({ ...prev, [dayKey]: false }))
    }
  }

  function updateDay(dayKey, patch) {
    setWeeklyConfig((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...patch },
    }))
  }

  return (
    <div className="grid">
      {error && <div className="alert-error">{error}</div>}
      {success && <div className="alert-success">{success}</div>}

      {/* ── Profil du kiné ───────────────────────────────────────────── */}
      <div className="card grid">
        <h2 style={{ margin: 0 }}>Profil du kiné</h2>
        <div className="grid grid-2">
          <div className="grid">
            <label>Nom
              <input
                value={therapist?.full_name || ''}
                onChange={(e) => setTherapist({ ...therapist, full_name: e.target.value })}
              />
            </label>
            <label>Adresse de départ par défaut
              <AddressAutocomplete
                value={therapist?.default_start_address || ''}
                onChange={(v) => setTherapist({ ...therapist, default_start_address: v })}
                onSelect={(s) => setTherapist({ ...therapist, default_start_address: s.display, default_start_lat: s.lat, default_start_lng: s.lng })}
                placeholder="Votre cabinet, domicile…"
              />
            </label>
          </div>
          <div className="grid">
            <label>Adresse d'arrivée par défaut
              <AddressAutocomplete
                value={therapist?.default_end_address || ''}
                onChange={(v) => setTherapist({ ...therapist, default_end_address: v })}
                onSelect={(s) => setTherapist({ ...therapist, default_end_address: s.display, default_end_lat: s.lat, default_end_lng: s.lng })}
                placeholder="Votre cabinet, domicile…"
              />
            </label>
            <div className="grid grid-2">
              <label>Buffer trajet (min)
                <input
                  type="number" min="0"
                  value={therapist?.travel_buffer_min ?? 10}
                  onChange={(e) => setTherapist({ ...therapist, travel_buffer_min: Number(e.target.value) })}
                />
              </label>
              <label>Buffer inter-séance (min)
                <input
                  type="number" min="0"
                  value={therapist?.session_buffer_min ?? 5}
                  onChange={(e) => setTherapist({ ...therapist, session_buffer_min: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        </div>
        <div>
          <button className="primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Sauvegarde…' : 'Sauvegarder le profil'}
          </button>
        </div>
      </div>

      {/* ── Config par jour ──────────────────────────────────────────── */}
      <h3 style={{ margin: '8px 0 0' }}>Configuration par jour</h3>
      {DAY_KEYS.map((dayKey, index) => {
        const row = weeklyConfig[dayKey] || {
          day_key: dayKey,
          day_index: index + 1,
          enabled: index < 5,
          work_start: '08:30',
          work_end: '18:00',
          start_address: '',
          end_address: '',
          blocked_windows: [],
          max_visits: 20,
        }

        return (
          <div key={dayKey} className={`card grid ${!row.enabled ? 'day-card--disabled' : ''}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 10 }}>
                <h3 style={{ margin: 0 }}>{DAY_LABELS[dayKey]}</h3>
                {!row.enabled && <span className="badge badge-inactive">Désactivé</span>}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!row.enabled}
                    onChange={(e) => updateDay(dayKey, { enabled: e.target.checked })}
                  />
                  Actif
                </label>
                <button
                  className="secondary small-btn"
                  onClick={() => saveDay(dayKey)}
                  disabled={savingDay[dayKey]}
                >
                  {savingDay[dayKey] ? '…' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            {row.enabled && (
              <div className="grid grid-2">
                <div className="grid">
                  <div className="grid grid-2">
                    <label>Début journée
                      <input
                        type="time"
                        value={row.work_start || '08:30'}
                        onChange={(e) => updateDay(dayKey, { work_start: e.target.value })}
                      />
                    </label>
                    <label>Fin journée
                      <input
                        type="time"
                        value={row.work_end || '18:00'}
                        onChange={(e) => updateDay(dayKey, { work_end: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>Visites max
                    <input
                      type="number" min="1" max="50"
                      value={row.max_visits || 20}
                      onChange={(e) => updateDay(dayKey, { max_visits: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="grid">
                  <label>Adresse de départ spécifique
                    <AddressAutocomplete
                      value={row.start_address || ''}
                      placeholder="Par défaut : adresse du profil"
                      onChange={(v) => updateDay(dayKey, { start_address: v })}
                      onSelect={(s) => updateDay(dayKey, { start_address: s.display, start_lat: s.lat, start_lng: s.lng })}
                    />
                  </label>
                  <label>Adresse d'arrivée spécifique
                    <AddressAutocomplete
                      value={row.end_address || ''}
                      placeholder="Par défaut : adresse du profil"
                      onChange={(v) => updateDay(dayKey, { end_address: v })}
                      onSelect={(s) => updateDay(dayKey, { end_address: s.display, end_lat: s.lat, end_lng: s.lng })}
                    />
                  </label>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <BlockedWindowsEditor
                    windows={row.blocked_windows ?? []}
                    onChange={(w) => updateDay(dayKey, { blocked_windows: w })}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
