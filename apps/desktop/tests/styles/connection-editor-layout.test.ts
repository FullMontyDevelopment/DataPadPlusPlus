import { describe, expect, it } from 'vitest'
import styles from '../../src/app/components/workbench/ConnectionEditorDialog.css?raw'

describe('Connection editor style contract', () => {
  it('keeps discard confirmation above the form and bounded to the viewport', () => {
    expect(styles).toContain('.connection-discard-overlay { z-index: 31; padding: 16px; }')
    expect(styles).toMatch(/\.workbench-dialog\.connection-discard-dialog \{[^}]+width: min\(440px, 100%\)[^}]+max-height: calc\(100dvh - 32px\)/)
    expect(styles).toMatch(/\.connection-discard-message \{[^}]+overflow: auto/)
    expect(styles).toMatch(/\.connection-discard-dialog \.workbench-dialog-actions \{[^}]+flex: 0 0 auto[^}]+flex-wrap: wrap/)
    expect(styles).toMatch(/\.connection-discard-dialog button:focus-visible \{[^}]+outline: 2px solid var\(--accent\)/)
  })
  it('gives inputs scoped, theme-aware contrast and a visible focus treatment', () => {
    expect(styles).toContain('--connection-input-bg: color-mix(in srgb, var(--input-bg) 65%, var(--panel-bg-alt))')
    expect(styles).toContain('--connection-input-border: color-mix(in srgb, var(--text) 55%, var(--connection-input-bg))')
    expect(styles).toContain('background: var(--connection-input-bg)')
    expect(styles).toContain('border: 1px solid var(--connection-input-border)')
    expect(styles).toMatch(/:root\[data-theme='solarized-light'\] \.connection-editor-dialog \{ --connection-input-border: color-mix\(in srgb, var\(--text\) 85%/)
    expect(styles).toMatch(/\.connection-editor-dialog input:focus-visible[^}]+outline: 1px solid var\(--accent\)/)
  })
  it('makes selected methods obvious and lets long tab names wrap in narrow dialogs', () => {
    expect(styles).toMatch(/\.connection-method-tabs \{[^}]+flex-wrap: wrap/)
    expect(styles).toMatch(/\.connection-method-tabs button \{[^}]+white-space: normal/)
    expect(styles).toMatch(/button\[aria-selected=true\] \{[^}]+border-color: var\(--accent\)[^}]+font-weight: 600/)
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr)')
  })
  it('keeps secret inputs shrinkable alongside compact reveal controls', () => {
    expect(styles).toContain('.connection-secret-input > input, .connection-secret-input > textarea { flex: 1; min-width: 0; }')
    expect(styles).toContain('.connection-secret-input svg { width: 14px; height: 14px; }')
  })
})
