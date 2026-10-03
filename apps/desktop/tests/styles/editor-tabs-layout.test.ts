import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('editor tab styles', () => {
  it('uses a subtle three-pixel scrollbar only for the tab strip', () => {
    expect(styles).toMatch(
      /\.editor-tabs::-webkit-scrollbar\s*\{[^}]*height:\s*3px;/s,
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

  it('lets WebKit scrollbar dimensions win over standard scrollbar overrides', () => {
    expect(styles).toMatch(
      /@supports selector\(::-webkit-scrollbar\)\s*\{\s*\.editor-tabs\s*\{[^}]*scrollbar-width:\s*auto;[^}]*scrollbar-color:\s*auto;/s,
    )
  })

  it('uses compact text and clear pointer-reordering affordances', () => {
    expect(styles).toMatch(/\.editor-tab\s*\{[^}]*font-size:\s*12px;[^}]*cursor:\s*grab;/s)
    expect(styles).toMatch(/\.editor-tab\s*\{[^}]*flex:\s*0 0 auto;/s)
    expect(styles).not.toMatch(/\.editor-tabs\s*\{[^}]*scrollbar-gutter:\s*stable;/s)
    expect(styles).toMatch(/\.editor-tabs\.is-reordering \.editor-tab\s*\{[^}]*cursor:\s*grabbing;/s)
    expect(styles).toMatch(/\.editor-tab\.is-drop-after::after\s*\{[^}]*width:\s*3px;[^}]*pointer-events:\s*none;/s)
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
