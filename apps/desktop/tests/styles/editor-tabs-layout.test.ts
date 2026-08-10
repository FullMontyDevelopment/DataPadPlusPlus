import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('editor tab styles', () => {
  it('uses a subtle four-pixel scrollbar only for the tab strip', () => {
    expect(styles).toMatch(
      /\.editor-tabs::-webkit-scrollbar\s*\{[^}]*height:\s*4px;/s,
    )
    expect(styles).toMatch(
      /\.editor-tabs::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.editor-tabs::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px;[^}]*30%/s,
    )
    expect(styles).toMatch(
      /\*::-webkit-scrollbar\s*\{[^}]*width:\s*10px;[^}]*height:\s*10px;/s,
    )
  })

  it('keeps a subdued environment accent on inactive tabs', () => {
    expect(styles).toMatch(
      /\.editor-tab\.has-environment-color\s*\{[^}]*border-top-color:[^}]*48%/s,
    )
    expect(styles).toMatch(
      /\.editor-tab\.is-active\.has-environment-color\s*\{[^}]*border-top-color:\s*var\(--tab-env-color\);/s,
    )
    expect(styles).toMatch(
      /\.editor-tab\.is-active\.has-environment-color::before\s*\{/s,
    )
  })
})
