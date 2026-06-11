import { describe, expect, it } from 'vitest'
import {
  isEditableKeyboardTarget,
  isPlatformCopyShortcut,
} from '../../../../../src/app/components/workbench/results/data-grid-keyboard'

describe('data-grid keyboard helpers', () => {
  it('accepts ctrl+c on non-Apple platforms and ignores modified copy chords', () => {
    expect(isPlatformCopyShortcut({
      altKey: false,
      ctrlKey: true,
      key: 'c',
      metaKey: false,
      shiftKey: false,
    })).toBe(true)
    expect(isPlatformCopyShortcut({
      altKey: true,
      ctrlKey: true,
      key: 'c',
      metaKey: false,
      shiftKey: false,
    })).toBe(false)
    expect(isPlatformCopyShortcut({
      altKey: false,
      ctrlKey: true,
      key: 'x',
      metaKey: false,
      shiftKey: false,
    })).toBe(false)
  })

  it('detects editable keyboard targets', () => {
    expect(isEditableKeyboardTarget(document.createElement('input'))).toBe(true)
    expect(isEditableKeyboardTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableKeyboardTarget(document.createElement('select'))).toBe(true)

    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    expect(isEditableKeyboardTarget(editable)).toBe(true)
    expect(isEditableKeyboardTarget(document.createElement('button'))).toBe(false)
    expect(isEditableKeyboardTarget(null)).toBe(false)
  })
})
