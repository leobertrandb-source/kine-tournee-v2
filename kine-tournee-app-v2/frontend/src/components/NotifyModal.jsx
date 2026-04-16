import { useEffect, useState } from 'react'
import { useToast } from './Toast'

function toIntlNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('33')) return digits
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1)
  return digits.length >= 9 ? digits : null
}

function toSmsUrl(phone, message) {
  const num = toIntlNumber(phone)
  if (!num) return null
  return `sms:+${num}?body=${encodeURIComponent(message)}`
}

function toWhatsAppUrl(phone, message) {
  const num = toIntlNumber(phone)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}

const MSG_TYPES = [
  {
    key: 'planning',
    label: 'Planning semaine',
    intro: (weekLabel) => `Voici vos séances de kinésithérapie pour la semaine du ${weekLabel} :`,
  },
  {
    key: 'rappel',
    label: 'Rappel',
    intro: () => `Je vous rappelle vos prochaines séances de kinésithérapie :`,
  },
  {
    key: 'modif',
    label: 'Modification',
    intro: (weekLabel) => `Voici votre planning modifié pour la semaine du ${weekLabel} :`,
  },
]

function buildMessage(patientFirstName, visits, weekLabel, therapistName, msgType = 'planning') {
  const lines = visits.map((v) => {
    const date = new Date(v.date + 'T00:00:00')
    const dayLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    return `📅 ${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} : ${v.start_time.replace(':', 'h')} – ${v.end_time.replace(':', 'h')}`
  })

  const typeConf = MSG_TYPES.find((t) => t.key === msgType) ?? MSG_TYPES[0]
  const intro = typeConf.intro(weekLabel)

  return `Bonjour ${patientFirstName},

${intro}

${lines.join('\n')}

N'hésitez pas à me contacter en cas d'empêchement.

${therapistName || 'Votre kinésithérapeute'}`
}

function PatientNotifRow({ patient, visits, therapistName, weekLabel, msgType }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const firstName = patient.sms_first_name || patient.full_name?.split(' ')[0] || patient.full_name || 'Bonjour'

  // Message éditable — se réinitialise automatiquement quand le type global change
  const [message, setMessage] = useState(() => buildMessage(firstName, visits, weekLabel, therapistName, msgType))
  useEffect(() => {
    setMessage(buildMessage(firstName, visits, weekLabel, therapistName, msgType))
  }, [msgType]) // eslint-disable-line react-hooks/exhaustive-deps

  const smsUrl = toSmsUrl(patient.phone, message)
  const waUrl = toWhatsAppUrl(patient.phone, message)
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
          {smsUrl
            ? <a className="notif-btn notif-btn--sms" href={smsUrl}>📱 SMS</a>
            : <span className="small muted" title="Numéro manquant">📱</span>
          }
          {waUrl
            ? <a className="notif-btn notif-btn--wa" href={waUrl} target="_blank" rel="noopener noreferrer">💬 WA</a>
            : null
          }
          {mailUrl
            ? <a className="notif-btn notif-btn--mail" href={mailUrl}>✉ Email</a>
            : null
          }
          <button className="notif-btn notif-btn--copy" onClick={(e) => { e.stopPropagation(); copy() }}>📋 Copier</button>
          <span className="notif-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 16px 12px' }}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={10}
            style={{
              width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
              fontSize: 13, lineHeight: 1.5, padding: '8px 10px',
              borderRadius: 6, border: '1px solid var(--border)',
              resize: 'vertical', background: 'var(--surface2)',
            }}
          />
          <button
            className="secondary small-btn"
            style={{ marginTop: 4 }}
            onClick={() => setMessage(buildMessage(firstName, visits, weekLabel, therapistName, msgType))}
          >
            ↺ Réinitialiser
          </button>
        </div>
      )}
    </div>
  )
}

export default function NotifyModal({ schedule, patients, therapist, onClose }) {
  const [msgType, setMsgType] = useState('planning')

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

  // Joindre avec les données patient (email, phone, sms_first_name)
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

        {/* Sélecteur de type de message global */}
        <div style={{ padding: '10px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Type de message</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {MSG_TYPES.map((t) => (
              <button
                key={t.key}
                className={msgType === t.key ? 'primary small-btn' : 'secondary small-btn'}
                onClick={() => setMsgType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="small muted" style={{ padding: '8px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          <strong>SMS</strong> ouvre votre messagerie avec le message pré-rempli. <strong>Copier</strong> pour coller manuellement.
        </div>

        <div className="notif-list">
          {rows.map(({ patient, visits }) => (
            <PatientNotifRow
              key={patient.id}
              patient={patient}
              visits={visits}
              therapistName={therapist?.full_name || therapist?.name}
              weekLabel={weekLabel}
              msgType={msgType}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
