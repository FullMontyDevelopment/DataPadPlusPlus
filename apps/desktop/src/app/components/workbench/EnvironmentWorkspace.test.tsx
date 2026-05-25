import { fireEvent, render, screen, within } from '@testing-library/react'
import type { EnvironmentProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentWorkspace } from './EnvironmentWorkspace'

describe('EnvironmentWorkspace', () => {
  it('confirms environment variable deletion without using the browser confirm dialog', () => {
    const onEnvironmentChange = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <EnvironmentWorkspace
        activeEnvironment={environment}
        environments={[environment]}
        onCreateEnvironment={vi.fn()}
        onCloneEnvironment={vi.fn()}
        onEnvironmentChange={onEnvironmentChange}
        onSaveEnvironment={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable API_TOKEN' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete API_TOKEN?' })
    expect(within(dialog).getByText(/removes the variable from this environment/i)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onEnvironmentChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Delete API_TOKEN?' })).not.toBeInTheDocument()
  })

  it('removes the selected environment variable and clears its secret draft after confirmation', () => {
    const onEnvironmentChange = vi.fn()
    const onSecretDraftsChange = vi.fn()

    render(
      <EnvironmentWorkspace
        activeEnvironment={environment}
        environments={[environment]}
        secretDrafts={{ API_TOKEN: 'draft-token' }}
        onCreateEnvironment={vi.fn()}
        onCloneEnvironment={vi.fn()}
        onEnvironmentChange={onEnvironmentChange}
        onSaveEnvironment={vi.fn()}
        onSecretDraftsChange={onSecretDraftsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable API_TOKEN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Variable' }))

    expect(onEnvironmentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        variableDefinitions: [
          expect.objectContaining({ key: 'DB_HOST' }),
        ],
      }),
    )
    expect(onEnvironmentChange.mock.calls[0]?.[0].variableDefinitions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'API_TOKEN' })]),
    )
    expect(onSecretDraftsChange).toHaveBeenCalledWith({})
  })
})

const environment: EnvironmentProfile = {
  id: 'env-qa',
  label: 'QA',
  color: '#6bbf59',
  risk: 'medium',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: true,
  safeMode: true,
  exportable: true,
  variableDefinitions: [
    {
      key: 'DB_HOST',
      kind: 'text',
      value: 'localhost',
      updatedAt: '2026-05-24T00:00:00.000Z',
    },
    {
      key: 'API_TOKEN',
      kind: 'secret',
      secretRef: {
        id: 'secret-env-qa-api-token',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'environment:env-qa:API_TOKEN',
        label: 'Environment env-qa variable API_TOKEN',
      },
      updatedAt: '2026-05-24T00:00:00.000Z',
    },
  ],
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:00.000Z',
}
