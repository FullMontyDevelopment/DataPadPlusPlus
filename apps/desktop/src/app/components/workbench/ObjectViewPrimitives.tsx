import type { ComponentType } from 'react'
import { WarningIcon } from './icons'

export type ObjectViewEmptyDescriptor = {
  emptyTitle: string
  emptyDescription: string
}

export function SectionHeading({
  Icon,
  title,
  unit,
}: {
  Icon: ComponentType<{ className?: string }>
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

export function PurposeEmptyState({ descriptor }: { descriptor: ObjectViewEmptyDescriptor }) {
  return (
    <div className="object-view-empty-panel">
      <strong>{descriptor.emptyTitle}</strong>
      <span>{descriptor.emptyDescription}</span>
    </div>
  )
}

export function KeyValueGrid({ rows, emptyText }: { rows: string[][]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <dl className="object-view-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}:${row.join('|')}`}>
              {columns.map((column, columnIndex) => (
                <td key={column}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div key={warning} className="object-view-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}
