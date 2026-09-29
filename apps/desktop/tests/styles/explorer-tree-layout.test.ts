import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('Library Explorer row layout', () => {
  it('reserves one trailing column for all optional row controls', () => {
    const rowStyles = styles.match(/\.connection-object-item\s*\{([^}]+)\}/)?.[1]
    expect(rowStyles).toMatch(
      /grid-template-columns:\s*14px 20px minmax\(0, 1fr\) auto;/,
    )
  })

  it('keeps counts, loading indicators, and actions on the same line', () => {
    const actionStyles = styles.match(/\.connection-object-item-actions\s*\{([^}]+)\}/)?.[1]
    expect(actionStyles).toMatch(
      /display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*6px;[^}]*flex-wrap:\s*nowrap;/s,
    )
  })
})
