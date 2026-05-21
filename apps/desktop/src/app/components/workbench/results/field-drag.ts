import type { DragEvent } from 'react'

export const FIELD_DRAG_MIME = 'application/x-datapadplusplus-field'
export const FIELD_DRAG_PAYLOAD_MIME = 'application/x-datapadplusplus-field-payload'
export const FIELD_POINTER_DRAG_MOVE_EVENT = 'datapadplusplus:field-pointer-drag-move'
export const FIELD_POINTER_DRAG_DROP_EVENT = 'datapadplusplus:field-pointer-drag-drop'
export const FIELD_POINTER_DRAG_CANCEL_EVENT = 'datapadplusplus:field-pointer-drag-cancel'
export interface FieldDragPayload {
  fieldPath: string
  value?: unknown
  valueLabel?: string
  valueType?: string
}

export interface FieldPointerDragDetail {
  clientX: number
  clientY: number
  payload: FieldDragPayload
}

let activeDraggedFieldPath = ''
let activeDraggedPayload: FieldDragPayload | undefined

export function writeFieldDragData(
  event: DragEvent<HTMLElement>,
  fieldPath: string,
  payload: Omit<FieldDragPayload, 'fieldPath'> = {},
) {
  beginFieldDrag(event, fieldPath, payload)
}

export function beginFieldDrag(
  event: DragEvent<HTMLElement>,
  fieldPath: string,
  payload: Omit<FieldDragPayload, 'fieldPath'> = {},
) {
  const trimmedFieldPath = fieldPath.trim()

  if (!trimmedFieldPath) {
    return
  }

  const nextPayload: FieldDragPayload = {
    fieldPath: trimmedFieldPath,
    ...payload,
  }

  activeDraggedFieldPath = trimmedFieldPath
  activeDraggedPayload = nextPayload
  setEffectAllowed(event)
  setDragData(event, FIELD_DRAG_MIME, trimmedFieldPath)
  setDragData(event, FIELD_DRAG_PAYLOAD_MIME, JSON.stringify(nextPayload))
  setDragData(event, 'text/plain', trimmedFieldPath)
  setDragData(event, 'text', trimmedFieldPath)
}

export function beginFieldPointerDrag(payload: FieldDragPayload) {
  if (!payload.fieldPath.trim()) {
    return
  }

  activeDraggedFieldPath = payload.fieldPath.trim()
  activeDraggedPayload = {
    ...payload,
    fieldPath: activeDraggedFieldPath,
  }
  document.body.classList.add('is-field-pointer-dragging')
}

export function moveFieldPointerDrag(clientX: number, clientY: number) {
  if (!activeDraggedPayload) {
    return
  }

  window.dispatchEvent(
    new CustomEvent<FieldPointerDragDetail>(FIELD_POINTER_DRAG_MOVE_EVENT, {
      detail: {
        clientX,
        clientY,
        payload: activeDraggedPayload,
      },
    }),
  )
}

export function dropFieldPointerDrag(clientX: number, clientY: number) {
  if (!activeDraggedPayload) {
    return
  }

  const payload = activeDraggedPayload
  window.dispatchEvent(
    new CustomEvent<FieldPointerDragDetail>(FIELD_POINTER_DRAG_DROP_EVENT, {
      detail: {
        clientX,
        clientY,
        payload,
      },
    }),
  )
  clearFieldDragData()
}

export function cancelFieldPointerDrag() {
  if (activeDraggedPayload) {
    window.dispatchEvent(new CustomEvent(FIELD_POINTER_DRAG_CANCEL_EVENT))
  }

  clearFieldDragData()
}

export function acceptFieldDrag(event: DragEvent<HTMLElement>) {
  if (!hasFieldDragData(event)) {
    return false
  }

  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  return true
}

export function clearFieldDragData() {
  activeDraggedFieldPath = ''
  activeDraggedPayload = undefined
  document.body.classList.remove('is-field-pointer-dragging')
}

export function hasFieldDragData(event: DragEvent<HTMLElement>) {
  return Boolean(activeDraggedFieldPath || dataTransferHasFieldData(event.dataTransfer))
}

export function readFieldDragData(event: DragEvent<HTMLElement>) {
  return readFieldDragPayload(event)?.fieldPath ?? (
    getDragData(event, FIELD_DRAG_MIME) ||
    getDragData(event, 'text/plain') ||
    activeDraggedFieldPath
  ).trim()
}

export function readFieldDragPayload(event: DragEvent<HTMLElement>): FieldDragPayload | undefined {
  const rawPayload = getDragData(event, FIELD_DRAG_PAYLOAD_MIME)

  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload) as FieldDragPayload
      const fieldPath = typeof parsed.fieldPath === 'string' ? parsed.fieldPath.trim() : ''

      if (fieldPath) {
        return { ...parsed, fieldPath }
      }
    } catch {
      // Fall through to field-only payloads from older drag sources.
    }
  }

  const rawFieldPath =
    getDragData(event, FIELD_DRAG_MIME) ||
    getDragData(event, 'text/plain') ||
    getDragData(event, 'text')
  const fieldPath = (rawFieldPath || activeDraggedFieldPath).trim()

  if (!fieldPath) {
    return activeDraggedPayload
  }

  return activeDraggedPayload?.fieldPath === fieldPath ? activeDraggedPayload : { fieldPath }
}

function dataTransferHasFieldData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types ?? []).some((type) =>
    [
      FIELD_DRAG_MIME,
      FIELD_DRAG_PAYLOAD_MIME,
      'text/plain',
      'text',
      'Text',
    ].includes(type),
  )
}

function getDragData(event: DragEvent<HTMLElement>, type: string) {
  try {
    return event.dataTransfer.getData(type)
  } catch {
    return ''
  }
}

function setEffectAllowed(event: DragEvent<HTMLElement>) {
  try {
    event.dataTransfer.effectAllowed = 'copy'
  } catch {
    // Some embedded WebViews are conservative with DataTransfer mutation.
    // The in-memory payload remains the source of truth for this drag.
  }
}

function setDragData(event: DragEvent<HTMLElement>, type: string, value: string) {
  try {
    event.dataTransfer.setData(type, value)
  } catch {
    // Keep later fallback writes running when a platform rejects a custom MIME.
  }
}
