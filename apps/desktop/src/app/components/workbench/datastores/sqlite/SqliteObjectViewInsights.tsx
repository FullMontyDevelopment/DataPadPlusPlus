import {
  ObjectDatabaseIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectTableIcon,
} from '../../icons'
import type { JsonRecord } from '../common/sql/RelationalObjectViewWorkspace.helpers'

interface SqliteObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function SqliteObjectViewInsights({ kind, payload }: SqliteObjectViewInsightsProps) {
  if (payload.engine !== 'sqlite') {
    return null
  }

  const tables = records(payload.tables)
  const views = records(payload.views)
  const indexes = records(payload.indexes)
  const triggers = records(payload.triggers)
  const pragmas = records(payload.pragmas)
  const checks = records(payload.checks)
  const maintenance = records(payload.maintenance)
  const attachedDatabases = records(payload.attachedDatabases)
  const schemaObjects = records(payload.schemaObjects)
  const virtualTables = records(payload.virtualTables)
  const generatedColumns = records(payload.generatedColumns)

  if (
    !tables.length &&
    !views.length &&
    !indexes.length &&
    !triggers.length &&
    !pragmas.length &&
    !checks.length &&
    !maintenance.length &&
    !attachedDatabases.length &&
    !schemaObjects.length &&
    !virtualTables.length &&
    !generatedColumns.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || views.length || attachedDatabases.length || schemaObjects.length) ? (
        <section className="object-view-section" aria-label="SQLite file posture">
          <SqliteSectionHeading icon="database" title="File" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Database" value={firstDisplay(payload.database, payload.objectName, firstField(attachedDatabases, 'name'))} />
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Views" value={views.length || undefined} />
            <Card label="Attached" value={attachedDatabases.length || undefined} />
          </div>
          <ChipRows rows={attachedDatabases.length ? attachedDatabases : tables} labelKey="name" valueKey={attachedDatabases.length ? 'status' : 'rows'} />
        </section>
      ) : null}

      {(pragmas.length || checks.length || maintenance.length) ? (
        <section className="object-view-section" aria-label="SQLite maintenance posture">
          <SqliteSectionHeading icon="maintenance" title="Maintenance" unit={`${checks.length + maintenance.length} signal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Quick Check" value={firstDisplay(payload.quickCheckStatus, firstField(checks, 'status'))} />
            <Card label="Journal" value={firstPragma(pragmas, 'journal_mode')} />
            <Card label="Page Size" value={firstPragma(pragmas, 'page_size')} />
            <Card label="Freelist" value={firstDisplay(payload.freelistCount, firstPragma(pragmas, 'freelist_count'))} />
          </div>
          <ChipRows rows={checks.length ? checks : pragmas} labelKey="name" valueKey={checks.length ? 'status' : 'value'} />
        </section>
      ) : null}

      {(indexes.length || triggers.length || generatedColumns.length) ? (
        <section className="object-view-section" aria-label="SQLite schema posture">
          <SqliteSectionHeading icon="index" title="Schema" unit={`${indexes.length + triggers.length} object(s)`} />
          <div className="object-view-card-grid">
            <Card label="Indexes" value={firstDisplay(payload.indexCount, indexes.length || undefined)} />
            <Card label="Unique" value={countTruthy(indexes, 'unique')} />
            <Card label="Triggers" value={triggers.length || undefined} />
            <Card label="Generated" value={generatedColumns.length || undefined} />
          </div>
          <ChipRows rows={indexes.length ? indexes : triggers} labelKey="name" valueKey={indexes.length ? 'columns' : 'event'} />
        </section>
      ) : null}

      {virtualTables.length ? (
        <section className="object-view-section" aria-label="SQLite virtual table posture">
          <SqliteSectionHeading icon="table" title="Virtual Tables" unit={`${virtualTables.length} table(s)`} />
          <div className="object-view-card-grid">
            <Card label="FTS" value={countMatching(virtualTables, 'module', 'fts')} />
            <Card label="RTree" value={countMatching(virtualTables, 'module', 'rtree')} />
            <Card label="Modules" value={uniqueFieldCount(virtualTables, 'module')} />
            <Card label="Tables" value={virtualTables.length} />
          </div>
          <ChipRows rows={virtualTables} labelKey="name" valueKey="module" />
        </section>
      ) : null}
    </>
  )
}

function SqliteSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'database' | 'index' | 'maintenance' | 'table'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'maintenance'
        ? ObjectJobIcon
        : icon === 'table'
          ? ObjectTableIcon
          : ObjectDatabaseIcon

  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function Card({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{display(value) || '-'}</strong>
    </div>
  )
}

function ChipRows({
  rows,
  labelKey,
  valueKey,
}: {
  rows: JsonRecord[]
  labelKey: string
  valueKey: string
}) {
  const chips = rows
    .map((row) => ({ label: display(row[labelKey]), value: display(row[valueKey]) }))
    .filter((row) => row.label && row.label !== '-')
    .slice(0, 8)

  if (!chips.length) {
    return null
  }

  return (
    <div className="object-view-chip-row">
      {chips.map((chip) => (
        <span key={`${chip.label}:${chip.value}`}>
          {chip.label}
          {chip.value && chip.value !== '-' ? (
            <>
              {' '}
              <strong>{chip.value}</strong>
            </>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstPragma(rows: JsonRecord[], name: string) {
  const row = rows.find((item) => display(item.name).toLowerCase() === name.toLowerCase())
  return firstDisplay(row?.value, row?.status)
}

function firstField(rows: JsonRecord[], key: string) {
  return firstDisplay(...rows.map((row) => row[key]))
}

function firstDisplay(...values: unknown[]) {
  return values.find((value) => display(value) && display(value) !== '-')
}

function countTruthy(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => /true|yes|1/i.test(display(row[key]))).length
  return rows.length ? `${count}/${rows.length}` : undefined
}

function countMatching(rows: JsonRecord[], key: string, needle: string) {
  return rows.filter((row) => display(row[key]).toLowerCase().includes(needle)).length || undefined
}

function uniqueFieldCount(rows: JsonRecord[], key: string) {
  const values = new Set(rows.map((row) => display(row[key])).filter((value) => value && value !== '-'))
  return values.size || undefined
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  return String(value)
}

function scopeLabel(kind: string) {
  return kind === 'table' || kind === 'view' || kind === 'index' ? 'object' : 'database'
}
