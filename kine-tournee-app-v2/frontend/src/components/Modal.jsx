import { useEffect } from 'react'

export default function Modal({ open, title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', onConfirm, onCancel, danger = false }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="modal-title">{title}</h3>}
        {message && <p className="modal-message">{message}</p>}
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
