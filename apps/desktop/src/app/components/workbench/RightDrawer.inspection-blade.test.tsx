import { fireEvent, render, screen } from '@testing-library/react'
import type { ExplorerInspectResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { defaultCapabilities } from '../../workspace-helpers'
import { InspectionBlade } from './RightDrawer.inspection-blade'

describe('InspectionBlade', () => {
  it('summarizes inspection metadata without exposing raw starter queries or secrets', () => {
    const onApplyTemplate = vi.fn()

    render(
      <InspectionBlade
        capabilities={defaultCapabilities()}
        inspection={inspection}
        onApplyTemplate={onApplyTemplate}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Products collection metadata is loaded.')).toBeInTheDocument()
    expect(screen.getByText(/A starter query is available for this object/)).toBeInTheDocument()
    expect(screen.getByText('Available actions')).toBeInTheDocument()
    expect(screen.getByText(/Live metadata\s+unavailable/)).toBeInTheDocument()
    expect(screen.queryByText('adapter')).not.toBeInTheDocument()
    expect(screen.getByText('Collection Name')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('Stored securely')).toBeInTheDocument()
    expect(screen.getByText('mongodb://admin:<redacted>@localhost:27017/catalog?token=<redacted>')).toBeInTheDocument()
    expect(screen.getByText('2 item(s)')).toBeInTheDocument()
    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret-pass/)).not.toBeInTheDocument()
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"collection"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"indexes"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply starter query' }))

    expect(onApplyTemplate).toHaveBeenCalledWith('{ "collection": "products", "filter": {} }')
  })
})

const inspection: ExplorerInspectResponse = {
  nodeId: 'mongodb:database:catalog:collection:products',
  summary: 'Products collection metadata is loaded.',
  queryTemplate: '{ "collection": "products", "filter": {} }',
  payload: {
    collectionName: 'products',
    password: 'super-secret',
    connectionString: 'mongodb://admin:secret-pass@localhost:27017/catalog?token=abc123',
    indexes: [{ name: '_id_' }, { name: 'sku_1' }],
    validationRules: { required: ['sku'] },
  },
}
