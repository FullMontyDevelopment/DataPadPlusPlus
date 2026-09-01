import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('context menu layout styles', () => {
  it('uses viewport constraints and contained scrolling on the shared surface', () => {
    expect(styles).toMatch(
      /\.context-menu-surface\s*\{[^}]*max-width:\s*var\(--context-menu-max-width\);[^}]*max-height:\s*var\(--context-menu-max-height\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
    )
  })

  it('uses a subtle four-pixel scrollbar without changing global scrollbars', () => {
    expect(styles).toMatch(
      /\.context-menu-surface::-webkit-scrollbar\s*\{[^}]*width:\s*4px;[^}]*height:\s*4px;/s,
    )
    expect(styles).toMatch(
      /\.context-menu-surface::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.context-menu-surface::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px;/s,
    )
  })

  it('wraps long menu labels instead of clipping their meaning', () => {
    expect(styles).toMatch(
      /\.context-menu-surface \[role\^='menuitem'\] > span\s*\{[^}]*overflow-wrap:\s*anywhere;/s,
    )
  })
})
