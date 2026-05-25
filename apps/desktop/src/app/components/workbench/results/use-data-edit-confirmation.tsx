import { useCallback, useState } from 'react'
import type { DataEditExecutionResponse } from '@datapadplusplus/shared-types'
import type { DataEditConfirmationHandler, ExecuteDataEditOptions } from './data-edit-confirmation'
import { dataEditConfirmationDetails } from './data-edit-confirmation'

interface PendingConfirmation {
  options: ExecuteDataEditOptions
  response: DataEditExecutionResponse
  resolve(value: boolean): void
}

export function useDataEditConfirmation() {
  const [pending, setPending] = useState<PendingConfirmation>()

  const confirmDataEdit = useCallback<DataEditConfirmationHandler>(
    (response, options) =>
      new Promise<boolean>((resolve) => {
        setPending({ response, options, resolve })
      }),
    [],
  )

  const close = (confirmed: boolean) => {
    const current = pending
    if (!current) {
      return
    }

    setPending(undefined)
    current.resolve(confirmed)
  }

  const details = pending
    ? dataEditConfirmationDetails(pending.response, pending.options)
    : undefined

  const confirmationDialog = pending && details ? (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-edit-confirmation-title"
      >
        <p className="sidebar-eyebrow">Guardrail</p>
        <h2 id="data-edit-confirmation-title">{details.title}</h2>
        <p>{details.action}</p>
        {details.reasons.length > 0 ? (
          <ul className="messages-list settings-warning-list">
            {details.reasons.map((reason) => (
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
            Continue
          </button>
        </div>
      </section>
    </div>
  ) : null

  return { confirmDataEdit, confirmationDialog }
}
