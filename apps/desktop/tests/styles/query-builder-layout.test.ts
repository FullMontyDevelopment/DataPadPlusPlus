import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('query builder layout styles', () => {
  it('expands validation errors below controls without vertically recentering the row', () => {
    expect(styles).toMatch(
      /\.query-builder-row:has\(> \.query-builder-typed-value\.has-error\)[^{]*\{[^}]*align-items:\s*start;/s,
    )
    expect(styles).toMatch(
      /\.cosmos-builder-routing:has\(> \.query-builder-typed-value\.has-error\)[^{]*\{[^}]*align-items:\s*start;/s,
    )
  })

  it('keeps inline utility buttons compact and visibly interactive', () => {
    expect(styles).toMatch(
      /\.query-builder-icon-button\s*\{[^}]*width:\s*28px;[^}]*height:\s*26px;/s,
    )
    expect(styles).toMatch(
      /\.query-builder-icon-button__icon\s*\{[^}]*width:\s*13px;[^}]*height:\s*13px;/s,
    )
    expect(styles).toMatch(
      /\.query-builder-icon-button:hover:not\(:disabled\),\s*\.query-builder-icon-button:focus-visible\s*\{[^}]*border-color:\s*var\(--accent\);/s,
    )
    expect(styles).toMatch(
      /\.query-builder-icon-button:disabled\s*\{[^}]*opacity:\s*0\.42;/s,
    )
    expect(styles).toMatch(
      /\.query-builder-row-actions\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*3px;/s,
    )
    expect(styles).toMatch(
      /\.query-builder-date-picker\s*\{[^}]*width:\s*28px;[^}]*overflow:\s*hidden;/s,
    )
    expect(styles).toMatch(
      /\.query-builder-date-picker__input\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;/s,
    )
  })
})
