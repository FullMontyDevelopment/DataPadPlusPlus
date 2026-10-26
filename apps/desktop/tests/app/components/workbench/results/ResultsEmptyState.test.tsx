import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { DATAPADPLUSPLUS_ADAPTER_MANIFESTS } from '@datapadplusplus/shared-types'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { ResultsView } from '../../../../../src/app/components/workbench/results/ResultsView'
import { BottomPanel } from '../../../../../src/app/components/workbench/BottomPanel'

vi.mock('../../../../../src/app/components/workbench/results/empty-state/byte-run/ByteRun', () => ({
  default: ({ onClose }: { onClose(): void }) => <section aria-label="Byte Run" onKeyDown={event => {
    if (event.key === 'Escape') onClose()
  }}><button onClick={onClose}>Close game</button></section>,
}))

const tab: QueryTabState = { id: 'tab', title: 'Test', connectionId: 'connection', environmentId: 'local',
  family: 'document', language: 'mongodb', editorLabel: 'Test', queryText: '{}', status: 'idle', dirty: false, history: [] }
function props(): ComponentProps<typeof ResultsView> {
  return { activeTab: tab, workspaceId: 'workspace', capabilities: { canCancel: false, canExplain: false,
    defaultRowLimit: 500, editorLanguage: 'mongodb', supportsLiveMetadata: false },
    onLoadNextPage: vi.fn(), onSelectRenderer: vi.fn(), onResultRendered: vi.fn(), onExportResultFile: vi.fn() }
}
function activate(count = 6) {
  const label = screen.getByRole('button', { name: 'No result yet.' })
  for (let i = 0; i < count; i++) fireEvent.click(label)
}

describe('Results empty state and isolated game entry', () => {
  it('opens exactly on six activations, restores focus on close, and never invokes result actions', async () => {
    const actions = props()
    render(<ResultsView {...actions} />)
    expect(screen.getByText('Run a query to see results here.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Copy result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export result' })).not.toBeInTheDocument()
    activate(5)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    activate(1)
    fireEvent.keyDown(await screen.findByRole('region', { name: 'Byte Run' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'No result yet.' })).toHaveFocus()
    activate(5)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    expect(actions.onLoadNextPage).not.toHaveBeenCalled()
    expect(actions.onSelectRenderer).not.toHaveBeenCalled()
    expect(actions.onResultRendered).not.toHaveBeenCalled()
    expect(actions.onExportResultFile).not.toHaveBeenCalled()
  })

  it('prevents repeated keyboard activations and preserves ordinary render progress', async () => {
    const current = props()
    const { rerender } = render(<ResultsView {...current} />)
    activate(3)
    const label = screen.getByRole('button', { name: 'No result yet.' })
    expect(fireEvent.keyDown(label, { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(label, { key: ' ', repeat: true })).toBe(false)
    rerender(<ResultsView {...current} theme="light" activeTab={{ ...tab, queryText: '{ updated: true }' }} />)
    activate(3)
    expect(await screen.findByRole('region', { name: 'Byte Run' })).toBeVisible()
  })

  it.each(['workspace', 'tab', 'connection', 'environment', 'scope', 'sqlScope'] as const)('resets on %s context change', async change => {
    const original = props()
    const { rerender } = render(<ResultsView {...original} />)
    activate()
    await screen.findByRole('region', { name: 'Byte Run' })
    const next = { ...original, activeTab: { ...tab } }
    if (change === 'workspace') next.workspaceId = 'other'
    if (change === 'tab') next.activeTab.id = 'other'
    if (change === 'connection') next.activeTab.connectionId = 'other'
    if (change === 'environment') next.activeTab.environmentId = 'other'
    if (change === 'scope') next.activeTab.scopedTarget = { kind: 'collection', label: 'other' }
    if (change === 'sqlScope') next.activeTab.sqlScope = { schema: 'other' }
    rerender(<ResultsView {...next} />)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    activate(5)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    activate(1)
    expect(await screen.findByRole('region', { name: 'Byte Run' })).toBeVisible()
  })

  const blocked: [string, Partial<ComponentProps<typeof ResultsView>>][] = [
    ...(['queued', 'running', 'blocked', 'error', 'success'] as const).map(status => [status, { activeTab: { ...tab, status } }] as [string, Partial<ComponentProps<typeof ResultsView>>]),
    ['execution lock', { executionLocked: true }], ['workspace lock', { workspaceLocked: true }],
    ['rendering', { rendererPreparing: true }], ['renderer error', { rendererError: 'Failed' }],
    ['active execution', { activeTab: { ...tab, activeExecution: { executionId: 'run', startedAt: '', phase: 'server' } } }],
    ['test suite', { activeTab: { ...tab, tabKind: 'test-suite' } }],
    ['no tab', { activeTab: undefined }],
    ['zero rows', { payload: { renderer: 'table', columns: ['id'], rows: [] } }],
    ['query error', { activeTab: { ...tab, error: { code: 'error', message: 'Failed' } } }],
  ]
  it.each(blocked)('unmounts the game and disallows activation for %s', async (_name, blockedProps) => {
    const current = props()
    const { rerender } = render(<ResultsView {...current} />)
    activate()
    await screen.findByRole('region', { name: 'Byte Run' })
    rerender(<ResultsView {...current} {...blockedProps} />)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No result yet.' })).not.toBeInTheDocument()
    rerender(<ResultsView {...current} />)
    activate(5)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
  })

  it.each(DATAPADPLUSPLUS_ADAPTER_MANIFESTS)('uses the same idle view for $engine', manifest => {
    const connection: ConnectionProfile = { id: 'connection', name: 'Test', engine: manifest.engine, family: manifest.family,
      environmentIds: ['local'], tags: [], favorite: false, readOnly: false, icon: '', auth: {}, createdAt: '', updatedAt: '' }
    render(<ResultsView {...props()} connection={connection} activeTab={{ ...tab, family: manifest.family }} />)
    expect(screen.getByRole('button', { name: 'No result yet.' })).toBeVisible()
  })

  it.each(['bottom', 'right'] as const)('resets when leaving Results in the %s dock', async dock => {
    const manifest = DATAPADPLUSPLUS_ADAPTER_MANIFESTS[0]!
    const current: ComponentProps<typeof BottomPanel> = {
      activeTab: tab, activeConnection: { id: 'connection', name: 'Test', engine: manifest.engine, family: manifest.family,
        environmentIds: ['local'], tags: [], favorite: false, readOnly: false, icon: '', auth: {}, createdAt: '', updatedAt: '' },
      activeEnvironment: { id: 'local', label: 'Local', color: '#808080', risk: 'low', variables: {}, sensitiveKeys: [],
        requiresConfirmation: false, safeMode: false, exportable: true, createdAt: '', updatedAt: '' },
      activePanelTab: 'results', dock, height: 260, capabilities: props().capabilities, workbenchMessages: [],
      onSelectPanelTab: vi.fn(), onSelectRenderer: vi.fn(), onLoadNextPage: vi.fn(), onResize: vi.fn(), onToggleDock: vi.fn(),
      onClose: vi.fn(), onConfirmExecution: vi.fn(), onApplyInspectionTemplate: vi.fn(), onRestoreHistory: vi.fn(),
      onExecuteDataEdit: vi.fn(), onDismissWorkbenchMessage: vi.fn(), onClearWorkbenchMessages: vi.fn(),
    }
    const { rerender } = render(<BottomPanel {...current} />)
    activate()
    await screen.findByRole('region', { name: 'Byte Run' })
    rerender(<BottomPanel {...current} activePanelTab="messages" />)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument())
    rerender(<BottomPanel {...current} />)
    activate(5)
    expect(screen.queryByRole('region', { name: 'Byte Run' })).not.toBeInTheDocument()
    rerender(<BottomPanel {...current} workspaceLocked />)
    expect(screen.queryByRole('button', { name: 'No result yet.' })).not.toBeInTheDocument()
  })
})
