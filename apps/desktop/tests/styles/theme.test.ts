import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('workbench theme styles', () => {
  it('themes the unified Library sidebar for light mode', () => {
    expect(styles).toContain(":root[data-theme='light']")
    expect(styles).toMatch(/--sidebar-bg:\s*#f3f3f3;/)
    expect(styles).toMatch(/--muted:\s*#616161;/)
    expect(styles).toMatch(/--activity-hover-bg:\s*rgba\(0,\s*0,\s*0,\s*0\.05\);/)
    expect(styles).toMatch(/\.workbench-sidebar\s*{[^}]*background:\s*var\(--sidebar-bg\);/s)
    expect(styles).not.toContain('.activity-bar')
  })

  it('keeps environment tab content below the editor tab strip', () => {
    expect(styles).toMatch(/\.environment-workspace\s*{[^}]*grid-row:\s*2\s*\/\s*-1;/s)
    expect(styles).not.toMatch(/\.environment-workspace\s*{[^}]*grid-row:\s*1\s*\/\s*-1;/s)
  })

  it('stretches graph results and their WebGL canvas through the available result height', () => {
    expect(styles).toMatch(
      /\.graph-result-view\s*{[^}]*min-height:\s*0;[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.graph-result-view\.has-warnings\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.graph-result-body\s*{[^}]*min-height:\s*0;[^}]*height:\s*100%;/s,
    )
    expect(styles).toMatch(
      /\.graph-result-canvas\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;/s,
    )
    expect(styles).toMatch(
      /\.panel-body-frame--results\s*>\s*\.graph-result-view\s*{[^}]*height:\s*100%;/s,
    )
  })
})
