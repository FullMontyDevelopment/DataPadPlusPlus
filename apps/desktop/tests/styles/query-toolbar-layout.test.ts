import styles from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('Query toolbar layout', () => {
  it('wraps controls within narrow query windows instead of clipping actions', () => {
    expect(styles.match(/\.editor-toolbar\s*\{([^}]+)\}/)?.[1]).toContain('flex-wrap: wrap;')
    const groups = styles.match(/\.editor-toolbar > \.toolbar-group\s*\{([^}]+)\}/)?.[1]
    expect(groups).toContain('flex-shrink: 0;')
    expect(groups).toContain('flex-wrap: wrap;')
    expect(groups).toContain('max-width: 100%;')
    expect(styles.match(/\.editor-toolbar\s*\{([^}]+)\}/)?.[1]).toContain('min-width: 0;')
    expect(styles.match(/\.toolbar-fetch-size\s*\{([^}]+)\}/)?.[1]).toContain('flex-wrap: wrap;')
    expect(styles.match(/\.toolbar-group--query-results\s*\{([^}]+)\}/)?.[1]).toContain('flex-wrap: wrap;')
  })

  it('emphasizes available cancellation with theme-aware danger colors and a solid stop symbol', () => {
    const cancel = styles.match(/\.toolbar-action--cancel:not\(:disabled\)\s*\{([^}]+)\}/)?.[1]
    expect(cancel).toContain('color: var(--danger);')
    expect(cancel).toContain('border-color: color-mix(in srgb, var(--danger)')
    expect(cancel).toContain('background: color-mix(in srgb, var(--danger)')
    expect(styles.match(/\.toolbar-action--cancel \.toolbar-icon rect\s*\{([^}]+)\}/)?.[1]).toContain('fill: currentColor;')
  })

  it('uses a compact, readable result-size input with a keyboard focus indicator', () => {
    const input = styles.match(/\.toolbar-fetch-size input\s*\{([^}]+)\}/)?.[1]
    expect(input).toContain('width: 72px;')
    expect(input).toContain('background: var(--input-bg);')
    expect(styles.match(/\.toolbar-fetch-size input:focus-visible\s*\{([^}]+)\}/)?.[1]).toContain('outline: 1px solid var(--accent);')
  })
})
