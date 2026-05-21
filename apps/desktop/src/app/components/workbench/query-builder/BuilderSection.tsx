import { useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  acceptFieldDrag,
  clearFieldDragData,
  readFieldDragPayload,
  type FieldDragPayload,
} from '../results/field-drag'

interface BuilderSectionProps {
  actionLabel: string
  children: ReactNode
  dragActive?: boolean
  dropHint?: string
  dropZone?: string
  onAdd(): void
  onDropField?(field: string, payload: FieldDragPayload): void
  secondaryActionLabel?: string
  onSecondaryAdd?(): void
  title: string
}

export function BuilderSection({
  actionLabel,
  children,
  dragActive: forcedDragActive = false,
  dropHint,
  dropZone,
  onAdd,
  onDropField,
  onSecondaryAdd,
  secondaryActionLabel,
  title,
}: BuilderSectionProps) {
  const [dragActive, setDragActive] = useState(false)
  const isDragActive = forcedDragActive || dragActive

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!onDropField) {
      return
    }

    if (acceptFieldDrag(event)) {
      setDragActive((current) => current || true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!onDropField) {
      return
    }

    const nextTarget = event.relatedTarget

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }

    setDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!onDropField) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const payload = readFieldDragPayload(event)
    const field = payload?.fieldPath

    if (field && payload) {
      onDropField(field, payload)
    }

    clearFieldDragData()
  }

  return (
    <section
      className={`query-builder-section${isDragActive ? ' is-drag-over' : ''}`}
      data-query-builder-drop-zone={dropZone}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="query-builder-section-header">
        <h3>{title}</h3>
        {dropHint ? <span className="query-builder-drop-hint">{dropHint}</span> : null}
        {secondaryActionLabel && onSecondaryAdd ? (
          <button type="button" className="drawer-button" onClick={onSecondaryAdd}>
            {secondaryActionLabel}
          </button>
        ) : null}
        <button type="button" className="drawer-button" onClick={onAdd}>
          {actionLabel}
        </button>
      </div>
      {children}
    </section>
  )
}
