import { describe, expect, it } from 'vitest'
import styles from '../../src/styles/index.css?raw'

describe('Explorer presentation styles', () => {
  it('uses theme-backed surfaces and fills the editor content area', () => {
    const rule = styles.match(/\.datastore-explorer-workspace\s*\{([^}]+)\}/)?.[1]
    expect(rule).toContain('grid-row: 2 / -1;')
    expect(rule).toContain('--surface: var(--editor-bg);')
    expect(rule).toContain('--panel: var(--panel-bg);')
    expect(rule).toContain('--input: var(--input-bg);')
  })
  it('gives object rows full-width hit targets and handles narrow editor panes, not just narrow windows', () => {
    expect(styles.match(/\.datastore-explorer-inventory li > button\s*\{([^}]+)\}/)?.[1]).toContain('width: 100%;')
    expect(styles).toContain('@container datastore-explorer (max-width: 720px)')
    expect(styles).toContain('.datastore-explorer-workspace button:focus-visible')
  })
})
