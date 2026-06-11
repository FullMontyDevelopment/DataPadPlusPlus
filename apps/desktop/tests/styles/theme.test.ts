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
})
