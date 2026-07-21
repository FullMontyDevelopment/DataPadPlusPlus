import { useCallback, useEffect, useRef, useState } from 'react'

export interface ReviewConfirmationDetails {
  action: string
  confirmLabel?: string
  eyebrow?: string
  reasons: string[]
  title: string
}

interface PendingReviewConfirmation extends ReviewConfirmationDetails {
  resolve(value: boolean): void
}

export function useReviewConfirmation() {
  const [pending, setPending] = useState<PendingReviewConfirmation>()
  const pendingRef = useRef<PendingReviewConfirmation | undefined>(undefined)

  const confirmReview = useCallback(
    (details: ReviewConfirmationDetails) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        const next = { ...details, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    if (!current) {
      return
    }

    pendingRef.current = undefined
    setPending(undefined)
    current.resolve(confirmed)
  }, [])

  useEffect(
    () => () => {
      const current = pendingRef.current
      if (current) {
        pendingRef.current = undefined
        current.resolve(false)
      }
    },
    [],
  )

  const reviewConfirmationDialog = pending ? (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-confirmation-title"
      >
        <p className="sidebar-eyebrow">{pending.eyebrow ?? 'Guardrail'}</p>
        <h2 id="review-confirmation-title">{pending.title}</h2>
        <p>{pending.action}</p>
        {pending.reasons.length > 0 ? (
          <ul className="messages-list settings-warning-list">
            {pending.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="drawer-button-row">
          <button type="button" className="drawer-button" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={() => close(true)}
          >
            {pending.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </section>
    </div>
  ) : null

  return { confirmReview, reviewConfirmationDialog }
}
