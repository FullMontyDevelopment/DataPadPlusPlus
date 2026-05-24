import { describe, expect, it } from 'vitest'
import {
  getWarehouseObjectViewDescriptor,
  isWarehouseObjectViewKind,
  warehouseObjectViewMenuLabel,
  WAREHOUSE_OBJECT_VIEW_KINDS,
} from './WarehouseObjectViewDescriptors'

describe('WarehouseObjectViewDescriptors', () => {
  it('covers the native warehouse object-view surface', () => {
    expect(WAREHOUSE_OBJECT_VIEW_KINDS).toEqual(
      expect.arrayContaining([
        'databases',
        'database',
        'datasets',
        'dataset',
        'schemas',
        'schema',
        'tables',
        'table',
        'views',
        'view',
        'materialized-views',
        'materialized-view',
        'stages',
        'stage',
        'warehouses',
        'warehouse',
        'jobs',
        'job',
        'tasks',
        'task',
        'security',
        'diagnostics',
      ]),
    )
  })

  it('normalizes menu labels and avoids generic open-view wording', () => {
    expect(warehouseObjectViewMenuLabel('materialized views')).toBe('Open Materialized Views')
    expect(warehouseObjectViewMenuLabel('WAREHOUSE')).toBe('Open Warehouse')
    expect(warehouseObjectViewMenuLabel('table')).toBe('Open Table')
    expect(warehouseObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('identifies known kinds and gives a safe fallback for unknown objects', () => {
    expect(isWarehouseObjectViewKind('datasets')).toBe(true)
    expect(isWarehouseObjectViewKind('stage')).toBe(true)
    expect(isWarehouseObjectViewKind('unknown')).toBe(false)
    expect(getWarehouseObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect Warehouse Object',
      title: 'Warehouse Object',
    })
  })
})
