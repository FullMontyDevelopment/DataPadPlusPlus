import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentEditProgress } from '../../../../../src/app/components/workbench/results/DocumentEditProgress'

describe('document edit progress', () => {
  it.each([
    ['unset-field', 'Removing…'], ['rename-field', 'Renaming…'],
    ['add-field', 'Adding…'], ['set-field', 'Saving…'], ['delete-document', 'Deleting…'],
  ] as const)('shows only a compact action label for %s, without routine guard text', (kind, label) => {
    const { container } = render(<DocumentEditProgress edit={{ kind, phase: 'executing', rowId: 'row' }} />)
    expect(screen.getByRole('status')).toHaveTextContent(label)
    expect(container).toHaveTextContent(label)
    expect(container.textContent).toBe(label)
    expect(container.querySelector('.document-edit-progress-spinner')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('only allows canceling preparation, not an already-submitted write', () => {
    const cancel = vi.fn()
    const { rerender } = render(<DocumentEditProgress onCancelLoading={cancel} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }))
    expect(cancel).toHaveBeenCalledTimes(1)
    rerender(<DocumentEditProgress edit={{ kind: 'rename-field', phase: 'confirming', rowId: 'row' }} onCancelLoading={cancel} />)
    expect(screen.getByRole('status')).toHaveTextContent('Confirm…')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
