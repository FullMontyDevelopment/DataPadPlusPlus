import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DataEditExecutionResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { useDataEditConfirmation } from '../../../../../src/app/components/workbench/results/use-data-edit-confirmation'

describe('useDataEditConfirmation', () => {
  it('resolves true when the user continues', async () => {
    const onResolved = vi.fn()
    render(<ConfirmationHarness onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(true)
    })
  })

  it('resolves false when the user cancels', async () => {
    const onResolved = vi.fn()
    render(<ConfirmationHarness onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(false)
    })
  })

  it('resolves false on unmount so pending edits cannot hang', async () => {
    const onResolved = vi.fn()
    const { unmount } = render(<ConfirmationHarness onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    expect(screen.getByRole('dialog', { name: 'Apply this edit?' })).toBeInTheDocument()

    unmount()

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(false)
    })
  })

  it('cancels a previous pending confirmation when a newer prompt opens', async () => {
    const onResolved = vi.fn()
    render(<ConfirmationHarness onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(false)
    })
    expect(onResolved).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(onResolved).toHaveBeenLastCalledWith(true)
    })
    expect(onResolved).toHaveBeenCalledTimes(2)
  })

  it('can cancel the active confirmation from the owning view', async () => {
    const onResolved = vi.fn()
    render(<ConfirmationHarness onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    expect(screen.getByRole('dialog', { name: 'Apply this edit?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel from owner' }))

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(false)
    })
    expect(screen.queryByRole('dialog', { name: 'Apply this edit?' })).not.toBeInTheDocument()
  })
})

function ConfirmationHarness({ onResolved }: { onResolved(value: boolean): void }) {
  const {
    cancelDataEditConfirmation,
    confirmDataEdit,
    confirmationDialog,
  } = useDataEditConfirmation()

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void Promise.resolve(
            confirmDataEdit(response, {
              actionLabel: 'Update field.',
              confirmationTitle: 'Apply this edit?',
            }),
          ).then(onResolved)
        }}
      >
        Open confirmation
      </button>
      <button type="button" onClick={cancelDataEditConfirmation}>
        Cancel from owner
      </button>
      {confirmationDialog}
    </>
  )
}

const response: DataEditExecutionResponse = {
  connectionId: 'conn-mongo',
  environmentId: 'env-qa',
  editKind: 'set-field',
  executionSupport: 'live',
  executed: false,
  plan: {
    operationId: 'mongodb.data-edit.set-field',
    engine: 'mongodb',
    summary: 'Updated document field.',
    generatedRequest: '{}',
    requestLanguage: 'mongodb',
    destructive: false,
    requiredPermissions: ['update collection document'],
    confirmationText: 'CONFIRM QA',
    warnings: ['QA requires confirmation.'],
  },
  messages: [],
  warnings: [],
}
