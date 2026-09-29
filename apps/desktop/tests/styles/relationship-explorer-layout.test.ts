import { describe, expect, it } from 'vitest'
import styles from '../../src/styles/index.css?raw'

describe('Relationship explorer layout', () => {
  it('spans the workbench content rows and gives the diagram all remaining height', () => {
    const host = styles.match(/\.datastore-explorer-relationship-view\s*\{([^}]+)\}/)?.[1]
    expect(host).toContain('grid-row: 2 / -1;')
    expect(host).toContain('display: grid;')
    expect(host).toContain('grid-template-rows: auto minmax(0, 1fr);')
    expect(host).toContain('min-height: 0;')
    expect(host).toContain('min-width: 0;')
    expect(host).toContain('overflow: hidden;')
  })
})
