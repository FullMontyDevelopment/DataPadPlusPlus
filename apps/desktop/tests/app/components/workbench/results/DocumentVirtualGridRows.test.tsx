import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentVirtualGridRows } from '../../../../../src/app/components/workbench/results/DocumentVirtualGridRows'
import type { DocumentGridRow } from '../../../../../src/app/components/workbench/results/document-grid-model'

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 30,
    getVirtualItems: () => [{ index: 0, key: 0, start: 0 }],
    measureElement: virtualizerMocks.measureElement,
  }),
}))

describe('DocumentVirtualGridRows', () => {
  it('measures rendered rows so an expanded inline editor is not clipped', () => {
    const row = {} as DocumentGridRow

    render(
      <DocumentVirtualGridRows
        rowCount={1}
        rowAt={() => row}
        renderRow={() => <div data-testid="document-row">Document row</div>}
      />,
    )

    const virtualRow = screen.getByTestId('document-row').closest('.document-data-grid-virtual-row')
    expect(virtualRow).toHaveAttribute('data-index', '0')
    expect(virtualizerMocks.measureElement).toHaveBeenCalledWith(virtualRow)
  })
})
