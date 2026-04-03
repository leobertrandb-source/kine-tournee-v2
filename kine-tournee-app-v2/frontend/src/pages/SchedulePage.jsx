export default function SchedulePage({ schedule, weekStart, setWeekStart, onGenerate }) {
  return (
    <div className="grid">
      <div className="card row">
        <label>Semaine du lundi
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </label>
        <button className="primary" onClick={onGenerate}>Générer la tournée</button>
      </div>

      <div className="card">
        <h2>Planning généré</h2>
        {!schedule && <div className="small">Aucune tournée générée pour l'instant.</div>}
        {schedule && (
          <div className="grid">
            {schedule.days.map((day) => (
              <div key={day.date} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{day.day} — {day.date}</strong>
                  <span className="small">Départ: {day.start_address || '-'} | Arrivée: {day.end_address || '-'}</span>
                </div>
                {!day.visits.length && <div className="small">Aucune visite planifiée.</div>}
                {!!day.visits.length && (
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Horaire</th>
                        <th>Déplacement</th>
                        <th>Durée</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.visits.map((visit) => (
                        <tr key={`${day.date}-${visit.patient_id}-${visit.start_time}`}>
                          <td>{visit.patient_name}<div className="small">{visit.address}</div></td>
                          <td>{visit.start_time} → {visit.end_time}</td>
                          <td>{visit.estimated_travel_min} min</td>
                          <td>{visit.session_duration_min} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            <pre>{JSON.stringify(schedule, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
