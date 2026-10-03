import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export function DocumentEditNotice({ message, onClose }: { message: string; onClose(): void }) {
  const titleId = useId()
  const messageId = useId()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const origin = document.activeElement
    button.current?.focus()
    return () => { if (origin instanceof HTMLElement && origin.isConnected) origin.focus() }
  }, [])

  return createPortal(
    <div className="workbench-modal-overlay" role="presentation">
      <section className="workbench-dialog document-edit-notice" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
          // This notice has one focusable control.
          if (event.key === 'Tab') { event.preventDefault(); button.current?.focus() }
        }}>
        <h2 id={titleId}>Edit could not be completed</h2>
        <p id={messageId} className="document-edit-notice-message">{message}</p>
        <div className="drawer-button-row">
          <button ref={button} type="button" className="drawer-button drawer-button--primary" onClick={onClose}>OK</button>
        </div>
      </section>
    </div>, document.body,
  )
}
