import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentEditNotice } from '../../../../../src/app/components/workbench/results/DocumentEditNotice'

describe('document edit notice', () => {
  it('portals outside clipped results, describes the reason, and restores focus on dismissal', () => {
    const originView = render(<input aria-label="Edit field" />)
    const origin = screen.getByRole('textbox', { name: 'Edit field' })
    origin.focus()
    const onClose = vi.fn()
    const view = render(<DocumentEditNotice message="The document changed. Review it before retrying." onClose={onClose} />)
    const notice = screen.getByRole('alertdialog', { name: 'Edit could not be completed' })
    expect(view.container).not.toContainElement(notice)
    expect(document.body).toContainElement(notice)
    expect(notice).toHaveAttribute('aria-modal', 'true')
    expect(notice).toHaveAccessibleDescription('The document changed. Review it before retrying.')
    const ok = within(notice).getByRole('button', { name: 'OK' })
    expect(ok).toHaveFocus()
    fireEvent.keyDown(ok, { key: 'Tab' })
    expect(ok).toHaveFocus()
    fireEvent.keyDown(ok, { key: 'Tab', shiftKey: true })
    expect(ok).toHaveFocus()
    fireEvent.click(ok)
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(origin).toHaveFocus()
    originView.unmount()
  })

  it('dismisses with Escape without propagating to the underlying editor', () => {
    const onClose = vi.fn()
    const parentKey = vi.fn()
    render(<div onKeyDown={parentKey}><DocumentEditNotice message="This connection is read-only." onClose={onClose} /></div>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'OK' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(parentKey).not.toHaveBeenCalled()
  })
})
