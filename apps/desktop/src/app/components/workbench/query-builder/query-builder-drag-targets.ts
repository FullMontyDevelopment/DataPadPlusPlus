import type { DragEvent } from 'react'

export function queryBuilderDropZoneFromEvent(event: DragEvent<HTMLElement>) {
  const target = event.target
  if (!(target instanceof Element)) {
    return undefined
  }
  return target.closest<HTMLElement>('[data-query-builder-drop-zone]')
    ?.dataset.queryBuilderDropZone
}

export function filterGroupIdFromDropZone(dropZone: string | undefined) {
  return dropZone?.startsWith('filters:') ? dropZone.slice('filters:'.length) : undefined
}

export function queryBuilderDropZoneFromPoint(clientX: number, clientY: number) {
  if (typeof document.elementFromPoint !== 'function') {
    return undefined
  }
  const target = document.elementFromPoint(clientX, clientY)
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-query-builder-drop-zone]')
      ?.dataset.queryBuilderDropZone
    : undefined
}

export function pointInsideElement(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}
