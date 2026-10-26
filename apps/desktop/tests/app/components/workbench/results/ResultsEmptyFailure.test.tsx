import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ResultsEmptyState } from '../../../../../src/app/components/workbench/results/empty-state/ResultsEmptyState'

vi.mock('../../../../../src/app/components/workbench/results/empty-state/byte-run/ByteRun', () => {
  throw new Error('Simulated chunk loading failure')
})

it('contains a failed lazy import and returns focus to the empty state', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(<ResultsEmptyState theme="dark" />)
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'No result yet.' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'No result yet.' })).toHaveFocus())
    expect(screen.getByText('Run a query to see results here.')).toBeVisible()
  } finally { consoleError.mockRestore() }
})
