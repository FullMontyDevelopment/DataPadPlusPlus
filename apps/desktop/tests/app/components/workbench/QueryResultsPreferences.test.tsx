import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_QUERY_RESULT_PREFERENCES,
  effectiveQueryBatchSize,
  validateQueryResultPreferences,
} from '@datapadplusplus/shared-types'
import { SettingsQueryResultsPanel } from '../../../../src/app/components/workbench/SettingsQueryResultsPanel'
import { QueryBatchSizeControl } from '../../../../src/app/components/workbench/QueryBatchSizeControl'

afterEach(cleanup)

describe('workspace query preferences', () => {
  it('defaults to bounded batches and unlimited totals', () => {
    expect(DEFAULT_QUERY_RESULT_PREFERENCES).toEqual({
      fetchBatchSize: 500, maximumLoadedRows: null, maximumExportedRows: null,
    })
    expect(effectiveQueryBatchSize({ ...DEFAULT_QUERY_RESULT_PREFERENCES, fetchBatchSize: 750 })).toBe(750)
    expect(effectiveQueryBatchSize(DEFAULT_QUERY_RESULT_PREFERENCES, 1200)).toBe(1200)
    expect(effectiveQueryBatchSize({ ...DEFAULT_QUERY_RESULT_PREFERENCES, maximumLoadedRows: 20 })).toBe(20)
  })

  it.each([0, -1, 5001, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid batch size %s', fetchBatchSize => {
    expect(() => validateQueryResultPreferences({ ...DEFAULT_QUERY_RESULT_PREFERENCES, fetchBatchSize })).toThrow()
  })

  it.each([0, -1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, 4_294_967_296])('does not treat invalid totals as unlimited: %s', maximumExportedRows => {
    expect(() => validateQueryResultPreferences({ ...DEFAULT_QUERY_RESULT_PREFERENCES, maximumExportedRows })).toThrow()
  })

  it('saves explicit totals and resets to real unlimited values', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<SettingsQueryResultsPanel onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: 'Maximum loaded rows: No limit' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Maximum exported rows: No limit' }))
    fireEvent.change(screen.getByLabelText('Maximum exported rows'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save query settings' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_QUERY_RESULT_PREFERENCES, maximumExportedRows: 1500 }))
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save query settings' }))
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(DEFAULT_QUERY_RESULT_PREFERENCES))
  })

  it('keeps an invalid partial settings draft editable without saving', () => {
    const onSave = vi.fn()
    render(<SettingsQueryResultsPanel onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Fetch batch size'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save query settings' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('validates the tab override and supports returning to the workspace default', async () => {
    const onChange = vi.fn().mockResolvedValue(true)
    render(<QueryBatchSizeControl value={750} inheritedValue={500} disabled={false} onChange={onChange} />)
    const input = screen.getByLabelText('Fetch batch size')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 5,000')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '1200' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(1200))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Default' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(undefined))
  })
})
