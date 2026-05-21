import type { DragEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIELD_DRAG_MIME,
  FIELD_DRAG_PAYLOAD_MIME,
  FIELD_POINTER_DRAG_CANCEL_EVENT,
  FIELD_POINTER_DRAG_DROP_EVENT,
  FIELD_POINTER_DRAG_MOVE_EVENT,
  acceptFieldDrag,
  beginFieldDrag,
  beginFieldPointerDrag,
  cancelFieldPointerDrag,
  clearFieldDragData,
  dropFieldPointerDrag,
  moveFieldPointerDrag,
  readFieldDragData,
  readFieldDragPayload,
  type FieldPointerDragDetail,
} from './field-drag'

describe('field-drag', () => {
  afterEach(() => {
    clearFieldDragData()
  })

  it('writes and reads the custom field payload', () => {
    const event = createDragEvent()

    beginFieldDrag(event, 'profile.status', {
      value: 'active',
      valueLabel: 'active',
      valueType: 'string',
    })

    expect(readFieldDragData(event)).toBe('profile.status')
    expect(readFieldDragPayload(event)).toEqual({
      fieldPath: 'profile.status',
      value: 'active',
      valueLabel: 'active',
      valueType: 'string',
    })
  })

  it('falls back to text/plain field data', () => {
    const event = createDragEvent({
      data: {
        'text/plain': 'sku',
      },
    })

    expect(readFieldDragPayload(event)).toEqual({ fieldPath: 'sku' })
  })

  it('keeps the active payload when a WebView rejects custom drag MIME writes', () => {
    const event = createDragEvent({
      failSetDataTypes: [FIELD_DRAG_MIME, FIELD_DRAG_PAYLOAD_MIME],
    })

    beginFieldDrag(event, 'sku', {
      value: 'luna-lamp',
      valueLabel: 'luna-lamp',
      valueType: 'string',
    })

    expect(readFieldDragPayload(createDragEvent())).toEqual({
      fieldPath: 'sku',
      value: 'luna-lamp',
      valueLabel: 'luna-lamp',
      valueType: 'string',
    })
    expect(event.dataTransfer.getData('text/plain')).toBe('sku')
  })

  it('uses the in-memory active payload when Chromium hides custom MIME during drop', () => {
    beginFieldDrag(createDragEvent(), 'inventory.available', {
      value: 18,
      valueLabel: '18',
      valueType: 'number',
    })

    const dropEvent = createDragEvent()

    expect(acceptFieldDrag(dropEvent)).toBe(true)
    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(dropEvent.dataTransfer.dropEffect).toBe('copy')
    expect(readFieldDragPayload(dropEvent)).toEqual({
      fieldPath: 'inventory.available',
      value: 18,
      valueLabel: '18',
      valueType: 'number',
    })
  })

  it('does not reuse stale active drag data after it is cleared', () => {
    beginFieldDrag(createDragEvent(), 'status', { value: 'active' })
    clearFieldDragData()

    expect(readFieldDragPayload(createDragEvent())).toBeUndefined()
    expect(acceptFieldDrag(createDragEvent())).toBe(false)
  })

  it('accepts browser dragover events that only expose DataTransfer types', () => {
    const event = createDragEvent({
      types: [FIELD_DRAG_MIME],
    })

    expect(acceptFieldDrag(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('copy')
  })

  it('emits pointer drag move and drop events with the active payload', () => {
    const moves: FieldPointerDragDetail[] = []
    const drops: FieldPointerDragDetail[] = []
    const onMove = (event: Event) =>
      moves.push((event as CustomEvent<FieldPointerDragDetail>).detail)
    const onDrop = (event: Event) =>
      drops.push((event as CustomEvent<FieldPointerDragDetail>).detail)

    window.addEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, onMove)
    window.addEventListener(FIELD_POINTER_DRAG_DROP_EVENT, onDrop)

    beginFieldPointerDrag({
      fieldPath: 'sku',
      value: 'luna-lamp',
      valueLabel: 'luna-lamp',
      valueType: 'string',
    })
    moveFieldPointerDrag(20, 30)
    dropFieldPointerDrag(40, 50)

    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({
      clientX: 20,
      clientY: 30,
      payload: { fieldPath: 'sku', value: 'luna-lamp' },
    })
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({
      clientX: 40,
      clientY: 50,
      payload: { fieldPath: 'sku', value: 'luna-lamp' },
    })
    expect(document.body).not.toHaveClass('is-field-pointer-dragging')

    window.removeEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, onMove)
    window.removeEventListener(FIELD_POINTER_DRAG_DROP_EVENT, onDrop)
  })

  it('clears pointer drag state on cancel', () => {
    const onCancel = vi.fn()
    window.addEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, onCancel)

    beginFieldPointerDrag({ fieldPath: 'sku' })
    expect(document.body).toHaveClass('is-field-pointer-dragging')
    cancelFieldPointerDrag()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveClass('is-field-pointer-dragging')
    expect(readFieldDragPayload(createDragEvent())).toBeUndefined()

    window.removeEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, onCancel)
  })
})

function createDragEvent({
  data = {},
  failSetDataTypes = [],
  types,
}: {
  data?: Record<string, string>
  failSetDataTypes?: string[]
  types?: string[]
} = {}) {
  const store = new Map(Object.entries(data))
  const failingTypes = new Set(failSetDataTypes)
  const dataTransfer = {
    dropEffect: 'none',
    effectAllowed: '',
    types: types ?? Array.from(store.keys()),
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      if (failingTypes.has(type)) {
        throw new Error(`Rejected ${type}`)
      }

      store.set(type, value)
      dataTransfer.types = Array.from(new Set([...dataTransfer.types, type]))
    },
  }

  return {
    dataTransfer,
    preventDefault: vi.fn(),
  } as unknown as DragEvent<HTMLElement>
}
