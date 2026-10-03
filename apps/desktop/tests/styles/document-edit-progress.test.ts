import css from '../../src/styles/index.css?raw'
import { describe, expect, it } from 'vitest'

describe('document edit progress layout', () => {
  it('uses compact inline progress without adding a results banner', () => {
    expect(css).toMatch(/\.document-data-grid-shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s)
    expect(css).toMatch(/\.document-edit-progress\s*\{[^}]*display:\s*inline-flex/s)
    expect(css).toMatch(/\.document-edit-progress\s*\{[^}]*flex:\s*0 0 auto/s)
    expect(css).not.toContain('.document-data-grid-header')
    expect(css).not.toContain('.document-edit-progress-message')
    expect(css).toMatch(/\.document-data-grid-cell--type:has\(\.document-edit-progress\)\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.document-edit-progress-spinner\s*\{\s*animation:\s*none/s)
  })
  it('keeps blocking reasons readable without overflowing the notice', () => {
    expect(css).toMatch(/\.document-edit-notice\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/\.document-edit-notice-message\s*\{[^}]*overflow-wrap:\s*anywhere/s)
  })
})
