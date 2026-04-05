import { useState } from 'react'
import { useToast } from './Toast'

// Formate un numéro français en format international pour WhatsApp
function toWhatsAppNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('33')) return digits
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1)
  return digits.length >= 9 ? digits : null
}

function buildMessage(patientFirstName, visits, weekLabel, therapistName) {
  const lines = visits.map((v) => {
    const date = new Date(v.date + 'T00:00:00')
    const dayLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    return `📅 ${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} : ${v.start_time.replace(':', 'h')} – ${v.end_time.replace(':', 'h')}`
  })

  return `Bonjour ${patientFirstName},

Voici vos séances de kinésithérapie pour la semaine du ${weekLabel} :

${lines.join('\n')}

N'hésitez pas à me contacter en cas d'empêchement.

${therapistName || 'Votre kinésithérapeute'}`
}

function PatientNotifRow({ patient, visits, therapistName, weekLabel }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const firstName = patient.full_name?.split(' ')[0] || patient.full_name || 'Bonjour'
  const message = buildMessage(firstName, visits, weekLabel, therapistName)
  const waNumber = toWhatsAppNumber(patient.phone)
  const waUrl = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null
  const mailUrl = patient.email
    ? `mailto:${patient.email}?subject=${encodeURIComponent(`Séances kinésithérapie – semaine du ${weekLabel}`)}&body=${encodeURIComponent(message)}`
    : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      toast.success('Message copié ✓')
    } catch {
      toast.error('Impossible de copier')
    }
  }

  return (
    <div className="notif-row">
      <div className="notif-row-header" onClick={() => setOpen((v) => !v)}>
        <div>
          <div style={{ fontWeight: 700 }}>{patient.full_name}</div>
          <div className="small muted">
            {visits.length} séance{visits.length > 1 ? 's' : ''} —{' '}
            {visits.map((v) => {
              const d = new Date(v.date + 'T00:00:00')
              return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
            }).join(', ')}
          </div>
        </div>
        <div className="notif-row-btns">
          {waUrl
            ? <a className="notif-btn notif-btn--wa" href={waUrl} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
            : <span className="small muted" title="Numéro manquant">💬</span>
          }
          {mailUrl
            ? <a className="notif-btn notif-btn--mail" href={mailUrl}>✉ Email</a>
            : <span className="small muted" title="Email manquant">✉</span>
          }
          <button className="notif-btn notif-btn--copy" onClick={(e) => { e.stopPropagation(); copy() }}>📋 Copier</button>
          <span className="notif-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <pre className="notif-preview">{message}</pre>
      )}
    </div>
  )
}

export default function NotifyModal({ schedule, patients, therapist, onClose }) {
  if (!schedule?.days) return null

  const weekLabel = new Date(schedule.week_start + 'T00:00:00')
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  // Regrouper les visites par patient_id
  const visitsByPatient = new Map()
  for (const day of schedule.days) {
    for (const visit of day.visits || []) {
      if (!visitsByPatient.has(visit.patient_id)) visitsByPatient.set(visit.patient_id, [])
      visitsByPatient.get(visit.patient_id).push({ ...visit, date: day.date })
    }
  }

  // Joindre avec les données patient (email, phone)
  const rows = [...visitsByPatient.entries()].map(([patientId, visits]) => {
    const patient = patients.find((p) => p.id === patientId) || { full_name: visits[0].patient_name, id: patientId }
    return { patient, visits }
  }).sort((a, b) => a.patient.full_name.localeCompare(b.patient.full_name))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📱 Notifier les patients</div>
            <div className="small muted">Semaine du {weekLabel} · {rows.length} patient(s)</div>
          </div>
          <button className="secondary small-btn" onClick={onClose}>✕</button>
        </div>

        <div className="small muted" style={{ padding: '8px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          Cliquez sur <strong>WhatsApp</strong> pour ouvrir le message pré-rempli, <strong>Email</strong> pour ouvrir votre messagerie, ou <strong>Copier</strong> pour un SMS manuel.
        </div>

        <div className="notif-list">
          {rows.map(({ patient, visits }) => (
            <PatientNotifRow
              key={patient.id}
              patient={patient}
              visits={visits}
              therapistName={therapist?.full_name || therapist?.name}
              weekLabel={weekLabel}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
