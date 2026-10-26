import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionResponse } from '@datapadplusplus/shared-types'
import { MessagesView } from '../../../../../src/app/components/workbench/bottom-panel/MessagesView'

describe('MessagesView', () => {
  it('does not duplicate the application approval dialog in Messages', () => {
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

    expect(screen.queryByRole('button', { name: /confirm|run|approve/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Global safe mode requires confirmation for risky work.')).not.toBeInTheDocument()
    expect(onOpenSecuritySettings).not.toHaveBeenCalled()
  })
})
