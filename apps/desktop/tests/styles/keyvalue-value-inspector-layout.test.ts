import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('key-value value inspector layout styles', () => {
  it('keeps the field name, content type, and size badges on one row', () => {
    expect(styles).toMatch(
      /\.document-field-inspector-header \.keyvalue-value-inspector-title\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/s,
    )
    expect(styles).toMatch(
      /\.keyvalue-value-inspector-title \.keyvalue-value-inspector-badge\s*\{[^}]*flex:\s*0 0 auto;/s,
    )
  })
})
