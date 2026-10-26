import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_QUERY_RESULT_PREFERENCES } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import { SettingsQueryResultsPanel } from '../../../../src/app/components/workbench/SettingsQueryResultsPanel'

afterEach(cleanup)
describe('Selected query settings', () => {
  it('saves new-builder policy separately from selected-query edits', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onApply = vi.fn()
    const snapshot = createSeedSnapshot()
    render(<SettingsQueryResultsPanel onSave={onSave} selectedQuery={{ snapshot, initialTabId: snapshot.tabs[0].id, onApply }} />)
    expect(screen.getByText('Selected query').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Default query limit')).toHaveValue('datastore-default')
    fireEvent.change(screen.getByLabelText('Default query limit'), { target: { value: 'limited' } })
    fireEvent.change(screen.getByLabelText('New builder query limit'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save query settings' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_QUERY_RESULT_PREFERENCES, newBuilderQueryLimit: { mode: 'limited', value: 75 } }))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('validates overrides and applies only to the explicitly selected query', async () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find(tab => tab.id === 'tab-mongo-catalog')!
    tab.queryFetchBatchSize = 750
    const onSave = vi.fn()
    const onApply = vi.fn().mockResolvedValue(true)
    render(<SettingsQueryResultsPanel onSave={onSave} selectedQuery={{ snapshot, initialTabId: tab.id, onApply }} />)
    fireEvent.click(screen.getByText('Selected query'))
    expect(screen.getByLabelText('Open query')).toHaveValue(tab.id)
    fireEvent.change(screen.getByLabelText('Query batch size'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Apply to selected query' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Query batch size'), { target: { value: '1200' } })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to selected query' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ tabId: tab.id, expectedRevision: snapshot.workspaceRevision ?? 0, fetchBatchSize: 1200, removeQueryLimit: false }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each(['running', 'closed', 'changed', 'other-window'] as const)('blocks a query that is %s', reason => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find(tab => tab.id === 'tab-mongo-catalog')!
    const onApply = vi.fn()
    const { rerender } = render(<SettingsQueryResultsPanel onSave={vi.fn()} selectedQuery={{ snapshot, initialTabId: tab.id, onApply }} />)
    fireEvent.click(screen.getByText('Selected query'))
    const next = structuredClone(snapshot)
    const nextTab = next.tabs.find(item => item.id === tab.id)!
    if (reason === 'running') nextTab.status = 'running'
    if (reason === 'closed') next.tabs = next.tabs.filter(item => item.id !== tab.id)
    if (reason === 'changed') nextTab.queryText = 'changed draft'
    if (reason === 'other-window') next.ui.workspaceWindows = [{ id: 'editor-other', role: 'editor', tabIds: [tab.id], activeTabId: tab.id, maximized: false }]
    rerender(<SettingsQueryResultsPanel onSave={vi.fn()} selectedQuery={{ snapshot: next, initialTabId: tab.id, onApply }} />)
    const button = screen.queryByRole('button', { name: 'Apply to selected query' })
    if (button) expect(button).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })
})
