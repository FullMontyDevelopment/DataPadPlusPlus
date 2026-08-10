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
})
