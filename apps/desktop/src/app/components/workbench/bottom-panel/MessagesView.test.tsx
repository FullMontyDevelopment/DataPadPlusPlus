import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionResponse } from '@datapadplusplus/shared-types'
import { MessagesView } from './MessagesView'

describe('MessagesView', () => {
  it('links global safe mode guardrails to Security settings', () => {
    const onOpenSecuritySettings = vi.fn()
    const lastExecution = {
      guardrail: {
        id: 'guardrail',
        status: 'confirm',
        reasons: ['Global safe mode requires confirmation for risky work.'],
        safeModeApplied: true,
      },
    } as unknown as ExecutionResponse

    render(
      <MessagesView
        lastExecution={lastExecution}
        messages={[]}
        workbenchMessages={[]}
        onClearWorkbenchMessages={vi.fn()}
        onConfirmExecution={vi.fn()}
        onDismissWorkbenchMessage={vi.fn()}
        onOpenSecuritySettings={onOpenSecuritySettings}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Security settings' }))

    expect(onOpenSecuritySettings).toHaveBeenCalledTimes(1)
  })
})
