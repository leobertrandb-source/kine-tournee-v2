import { useState } from 'react'
import { api } from '../lib/api'

const EMPTY = {
  full_name: '',
  address: '',
  lat: '',
  lng: '',
  session_duration_min: 30,
  sessions_per_week: 2,
  active: true,
  availability: {
    monday: { unavailable: false, available_windows: [], blocked_windows: [] },
    tuesday: { unavailable: false, available_windows: [], blocked_windows: [] },
    wednesday: { unavailable: false, available_windows: [], blocked_windows: [] },
    thursday: { unavailable: false, available_windows: [], blocked_windows: [] },
    friday: { unavailable: false, available_windows: [], blocked_windows: [] },
    saturday: { unavailable: true, available_windows: [], blocked_windows: [] },
    sunday: { unavailable: true, available_windows: [], blocked_windows: [] },
  },
}

export default function PatientsPage({ patients, setPatients }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await api.createPatient({
        ...form,
        lat: form.lat === '' ? null : Number(form.lat),
        lng: form.lng === '' ? null : Number(form.lng),
      })
      setPatients((prev) => [created, ...prev])
      setForm(EMPTY)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await api.deletePatient(id)
    setPatients((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <h2>Nouveau patient</h2>
        <form className="grid" onSubmit={handleSave}>
          <label>Nom complet<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
          <label>Adresse<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required /></label>
          <div className="grid grid-2">
            <label>Latitude<input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></label>
            <label>Longitude<input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></label>
          </div>
          <div className="grid grid-2">
            <label>Durée séance (min)<input type="number" value={form.session_duration_min} onChange={(e) => setForm({ ...form, session_duration_min: Number(e.target.value) })} /></label>
            <label>Séances / semaine<input type="number" value={form.sessions_per_week} onChange={(e) => setForm({ ...form, sessions_per_week: Number(e.target.value) })} /></label>
          </div>
          <div className="small">Les indisponibilités détaillées sont stockées dans le champ JSON `availability`. Pour une V1 simple, tu peux éditer ce JSON plus tard dans Supabase ou créer un formulaire avancé ensuite.</div>
          <button className="primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter le patient'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Patients</h2>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Adresse</th>
              <th>Séances/semaine</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr key={p.id}>
                <td>{p.full_name}</td>
                <td>{p.address}</td>
                <td>{p.sessions_per_week}</td>
                <td><button className="secondary" onClick={() => handleDelete(p.id)}>Supprimer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
