import { api } from '../lib/api'

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export default function SettingsPage({ therapist, setTherapist, weeklyConfig, setWeeklyConfig }) {
  async function saveProfile() {
    const saved = await api.updateTherapistProfile(therapist)
    setTherapist(saved)
  }

  async function saveDay(dayKey) {
    const saved = await api.updateDayConfig(dayKey, weeklyConfig[dayKey])
    setWeeklyConfig((prev) => ({ ...prev, [dayKey]: saved }))
  }

  return (
    <div className="grid">
      <div className="card grid grid-2">
        <div>
          <h2>Profil du kiné</h2>
          <label>Nom
            <input value={therapist?.full_name || ''} onChange={(e) => setTherapist({ ...therapist, full_name: e.target.value })} />
          </label>
          <label>Adresse de départ par défaut
            <input value={therapist?.default_start_address || ''} onChange={(e) => setTherapist({ ...therapist, default_start_address: e.target.value })} />
          </label>
          <label>Adresse d'arrivée par défaut
            <input value={therapist?.default_end_address || ''} onChange={(e) => setTherapist({ ...therapist, default_end_address: e.target.value })} />
          </label>
        </div>
        <div>
          <h2>Paramètres globaux</h2>
          <label>Buffer trajet (min)
            <input type="number" value={therapist?.travel_buffer_min || 10} onChange={(e) => setTherapist({ ...therapist, travel_buffer_min: Number(e.target.value) })} />
          </label>
          <label>Buffer séance (min)
            <input type="number" value={therapist?.session_buffer_min || 5} onChange={(e) => setTherapist({ ...therapist, session_buffer_min: Number(e.target.value) })} />
          </label>
          <button className="primary" onClick={saveProfile}>Sauvegarder le profil</button>
        </div>
      </div>

      {DAY_KEYS.map((dayKey, index) => {
        const row = weeklyConfig[dayKey] || { day_key: dayKey, day_index: index + 1, enabled: index < 5, work_start: '08:30', work_end: '18:00', start_address: '', end_address: '', blocked_windows: [] }
        return (
          <div className="card grid grid-2" key={dayKey}>
            <div>
              <h3>{dayKey}</h3>
              <label>Actif
                <select value={String(row.enabled)} onChange={(e) => setWeeklyConfig((prev) => ({ ...prev, [dayKey]: { ...row, enabled: e.target.value === 'true' } }))}>
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </select>
              </label>
              <label>Début journée<input type="time" value={row.work_start || '08:30'} onChange={(e) => setWeeklyConfig((prev) => ({ ...prev, [dayKey]: { ...row, work_start: e.target.value } }))} /></label>
              <label>Fin journée<input type="time" value={row.work_end || '18:00'} onChange={(e) => setWeeklyConfig((prev) => ({ ...prev, [dayKey]: { ...row, work_end: e.target.value } }))} /></label>
            </div>
            <div>
              <label>Adresse de départ<input value={row.start_address || ''} onChange={(e) => setWeeklyConfig((prev) => ({ ...prev, [dayKey]: { ...row, start_address: e.target.value } }))} /></label>
              <label>Adresse d'arrivée<input value={row.end_address || ''} onChange={(e) => setWeeklyConfig((prev) => ({ ...prev, [dayKey]: { ...row, end_address: e.target.value } }))} /></label>
              <div className="small">Les pauses / indisponibilités du kiné sont stockées dans `blocked_windows` (JSON). Tu pourras les éditer avec un mini-builder ensuite.</div>
              <button className="secondary" onClick={() => saveDay(dayKey)}>Sauvegarder {dayKey}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
