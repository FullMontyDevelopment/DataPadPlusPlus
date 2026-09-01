import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('Library toolbar styles', () => {
  it('fills the toolbar and pushes the primary connection action to the far edge', () => {
    expect(styles).toMatch(
      /\.sidebar-actions--library\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    )
    expect(styles).toMatch(
      /\.sidebar-icon-button--library-primary\s*\{[^}]*margin-inline-start:\s*auto;/s,
    )
  })

  it('gives the primary action a persistent accent treatment and a compact plus badge', () => {
    expect(styles).toMatch(
      /\.sidebar-icon-button--library-primary\s*\{[^}]*border-color:[^}]*var\(--accent\)[^}]*background:\s*var\(--accent-soft\);/s,
    )
    expect(styles).toMatch(
      /\.sidebar-icon-button--library-primary:hover,[\s\S]*?\.sidebar-icon-button--library-primary:focus-visible\s*\{[^}]*border-color:\s*var\(--accent\);/s,
    )
    expect(styles).toMatch(
      /\.sidebar-create-connection-icon-badge\s*\{[^}]*position:\s*absolute;[^}]*width:\s*9px;[^}]*height:\s*9px;[^}]*background:\s*var\(--accent\);/s,
    )
  })
})
