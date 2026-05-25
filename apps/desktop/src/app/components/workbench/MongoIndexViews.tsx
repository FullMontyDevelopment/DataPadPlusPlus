import { useCallback } from 'react'
import type { ComponentType } from 'react'
import { HideIcon, ObjectIndexIcon, PlusIcon, ShowIcon, TrashIcon } from './icons'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'

type JsonRecord = Record<string, unknown>

interface MongoOperationPlanHandler {
  (request: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }): void
}

export function MongoIndexesView({
  descriptor,
  payload,
  onOpenCreateIndex,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onOpenCreateIndex?: () => void
  onPlanOperation?: MongoOperationPlanHandler
}) {
  const indexes = extractIndexes(payload)
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const summaryRows = [
    ['Indexes', String(indexes.length)],
    ['Unique', String(indexes.filter((index) => Boolean(index.unique)).length)],
    ['TTL', String(indexes.filter((index) => index.expireAfterSeconds !== undefined).length)],
    ['Hidden', String(indexes.filter((index) => Boolean(index.hidden)).length)],
  ]
  const previewDrop = useCallback((name: string) => {
    onPlanOperation?.({
      title: `Drop index ${name}`,
      operationId: 'mongodb.index.drop',
      objectName: collection,
      parameters: {
        database,
        collection,
        indexName: name,
      },
    })
  }, [collection, database, onPlanOperation])
  const previewVisibility = useCallback((name: string, hidden: boolean) => {
    onPlanOperation?.({
      title: `${hidden ? 'Unhide' : 'Hide'} index ${name}`,
      operationId: hidden ? 'mongodb.index.unhide' : 'mongodb.index.hide',
      objectName: collection,
      parameters: {
        database,
        collection,
        indexName: name,
      },
    })
  }, [collection, database, onPlanOperation])

  return (
    <div className="object-view-section">
      <div className="object-view-section-heading-row">
        <SectionHeading Icon={ObjectIndexIcon} title={descriptor.title} unit={`${indexes.length} index(es)`} />
        {onOpenCreateIndex ? (
          <button
            type="button"
            className="drawer-button"
            disabled={!collection}
            onClick={onOpenCreateIndex}
          >
            <PlusIcon className="panel-inline-icon" />
            Create Index
          </button>
        ) : null}
      </div>
      <div className="object-view-card-grid">
        {summaryRows.map(([label, value]) => (
          <div key={label} className="object-view-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {indexes.length === 0 ? (
        <PurposeEmptyState descriptor={descriptor} />
      ) : (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                {['Name', 'Key pattern', 'Unique', 'Sparse', 'TTL', 'Hidden', 'Usage', 'Options', 'Actions'].map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => {
                const name = stringValue(index.name)
                return (
                  <tr key={name || compactJson(index.key)}>
                    <td>{name}</td>
                    <td>{indexKeyPatternText(index.key)}</td>
                    <td>{booleanText(index.unique)}</td>
                    <td>{booleanText(index.sparse)}</td>
                    <td>{stringValue(index.expireAfterSeconds)}</td>
                    <td>{booleanText(index.hidden)}</td>
                    <td>{indexUsageText(index)}</td>
                    <td>{indexOptionsSummary(index, ['name', 'key', 'unique', 'sparse', 'expireAfterSeconds', 'hidden', 'accesses', 'usage'])}</td>
                    <td>
                      <div className="object-view-button-row object-view-button-row--compact">
                        <button
                          type="button"
                          className="object-view-icon-action"
                          aria-label={index.hidden ? `Unhide index ${name}` : `Hide index ${name}`}
                          disabled={!onPlanOperation || !name || name === '_id_'}
                          title={name === '_id_' ? 'MongoDB primary _id index cannot be hidden.' : index.hidden ? 'Unhide index' : 'Hide index'}
                          onClick={() => previewVisibility(name, Boolean(index.hidden))}
                        >
                          {index.hidden ? <ShowIcon className="toolbar-icon" /> : <HideIcon className="toolbar-icon" />}
                        </button>
                        <button
                          type="button"
                          className="object-view-icon-action is-danger"
                          aria-label={`Drop index ${name}`}
                          disabled={!onPlanOperation || !name || name === '_id_'}
                          title={name === '_id_' ? 'MongoDB primary _id index cannot be dropped.' : 'Drop index'}
                          onClick={() => previewDrop(name)}
                        >
                          <TrashIcon className="toolbar-icon" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SectionHeading({
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

function PurposeEmptyState({ descriptor }: { descriptor: MongoObjectViewDescriptor }) {
  return (
    <div className="object-view-empty-panel">
      <strong>{descriptor.emptyTitle}</strong>
      <span>{descriptor.emptyDescription}</span>
    </div>
  )
}

function extractIndexes(payload: JsonRecord) {
  const indexes = payload.indexes
  const result = asRecord(payload.result)
  const directIndexes = Array.isArray(indexes) ? indexes : undefined
  const commandIndexes = asRecord(indexes)?.cursor
    ? asRecord(asRecord(indexes)?.cursor)?.firstBatch
    : result?.cursor
      ? asRecord(result.cursor)?.firstBatch
      : undefined
  const rows = directIndexes ?? (Array.isArray(commandIndexes) ? commandIndexes : [])
  return rows.map(asRecord).filter(Boolean) as JsonRecord[]
}

function indexKeyPatternText(value: unknown) {
  const key = asRecord(value)
  const entries = Object.entries(key)
  if (entries.length === 0) {
    return stringValue(value) || 'No key pattern'
  }

  return entries
    .map(([field, direction]) => `${field} ${indexDirectionText(direction)}`)
    .join(', ')
}

function indexDirectionText(value: unknown) {
  if (value === 1 || value === '1') {
    return 'ascending'
  }
  if (value === -1 || value === '-1') {
    return 'descending'
  }
  return stringValue(value) || 'custom'
}

function indexOptionsSummary(index: JsonRecord, omittedKeys: string[]) {
  const entries = Object.entries(withoutKeys(index, omittedKeys))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')

  if (entries.length === 0) {
    return 'Default options'
  }

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${humanizeMetric(key)}: ${shortValueSummary(value)}`)
    .join(', ')
}

function indexUsageText(index: JsonRecord) {
  const accesses = asRecord(index.accesses)
  const usage = asRecord(index.usage)
  const ops = accesses.ops ?? usage.ops ?? usage.operationCount
  return ops !== undefined ? `${stringValue(ops)} op(s)` : ''
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function withoutKeys(record: JsonRecord, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

function shortValueSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} item(s)`
  }
  if (value && typeof value === 'object') {
    return `${Object.keys(value).length} field(s)`
  }
  return stringValue(value) || ''
}

function humanizeMetric(key: string) {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function booleanText(value: unknown) {
  return value === undefined ? '' : value ? 'Yes' : 'No'
}

function compactJson(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}
