import {
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
} from '../../icons'
import type { JsonRecord } from '../common/sql/RelationalObjectViewWorkspace.helpers'

interface DuckDbObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function DuckDbObjectViewInsights({ kind, payload }: DuckDbObjectViewInsightsProps) {
  if (payload.engine !== 'duckdb') {
    return null
  }

  const tables = records(payload.tables)
  const views = records(payload.views)
  const files = records(payload.files)
  const extensions = records(payload.extensions)
  const attachedDatabases = records(payload.attachedDatabases)
  const pragmas = records(payload.pragmas)
  const checks = records(payload.checks)
  const diagnostics = records(payload.diagnostics)
  const statistics = records(payload.statistics)

  if (
    !tables.length &&
    !views.length &&
    !files.length &&
    !extensions.length &&
    !attachedDatabases.length &&
    !pragmas.length &&
    !checks.length &&
    !diagnostics.length &&
    !statistics.length
  ) {
    return null
  }

  return (
    <>
      <section className="object-view-section" aria-label="DuckDB local file posture">
        <DuckDbSectionHeading icon="database" title="Local File" unit={engineScope(kind)} />
        <div className="object-view-card-grid">
          {card('Database', firstDisplay(payload.database, payload.databaseName, payload.name))}
          {card('Size', firstDisplay(payload.databaseSize, payload.totalSize, firstField(statistics, 'size')))}
          {card('Tables', firstDisplay(payload.tableCount, tables.length || undefined))}
          {card('Attached', firstDisplay(attachedDatabases.length || undefined))}
        </div>
        <DuckDbChipRow rows={attachedDatabases} labelKey="name" valueKey="status" limit={4} />
      </section>

      {(files.length || tables.length || statistics.length) ? (
        <section className="object-view-section" aria-label="DuckDB file analytics posture">
          <DuckDbSectionHeading icon="file" title="File Analytics" unit={`${files.length || tables.length} source(s)`} />
          <div className="object-view-card-grid">
            {card('Files', firstDisplay(files.length || undefined))}
            {card('Rows', firstDisplay(firstField(statistics, 'rows'), firstField(tables, 'rows')))}
            {card('Format', firstDisplay(firstField(files, 'format'), firstField(files, 'type'), 'duckdb'))}
            {card('Scans', firstDisplay(firstField(statistics, 'scans')))}
          </div>
          <DuckDbChipRow rows={files.length ? files : tables} labelKey="name" valueKey={files.length ? 'format' : 'size'} limit={5} />
        </section>
      ) : null}

      {extensions.length ? (
        <section className="object-view-section" aria-label="DuckDB extension posture">
          <DuckDbSectionHeading icon="extension" title="Extensions" unit={`${extensions.length} extension(s)`} />
          <div className="object-view-card-grid">
            {card('Loaded', extensions.filter((extension) => /loaded|true/i.test(displayValue(extension.loaded ?? extension.version))).length || '-')}
            {card('Installed', extensions.filter((extension) => /installed|yes|true/i.test(displayValue(extension.installed ?? extension.schema))).length || '-')}
            {card('Available', extensions.filter((extension) => /available|not installed|false/i.test(displayValue(extension.loaded ?? extension.version ?? extension.schema))).length || '-')}
            {card('Remote', extensions.some((extension) => /httpfs|s3|azure|gcs/i.test(displayValue(extension.name))) ? 'available' : '-')}
          </div>
          <DuckDbChipRow rows={extensions} labelKey="name" valueKey="version" limit={5} />
        </section>
      ) : null}

      {(pragmas.length || checks.length || diagnostics.length) ? (
        <section className="object-view-section" aria-label="DuckDB maintenance posture">
          <DuckDbSectionHeading icon="maintenance" title="Maintenance" unit={`${checks.length + diagnostics.length} signal(s)`} />
          <div className="object-view-card-grid">
            {card('Memory', firstPragma(pragmas, 'memory_limit'))}
            {card('Threads', firstPragma(pragmas, 'threads'))}
            {card('Checks', firstDisplay(firstField(checks, 'status'), firstField(diagnostics, 'status')))}
            {card('Analyze', firstDisplay(firstField(statistics, 'lastAnalyze'), 'ready'))}
          </div>
          <DuckDbChipRow rows={diagnostics.length ? diagnostics : checks} labelKey="name" valueKey="status" limit={4} />
        </section>
      ) : null}
    </>
  )
}

function DuckDbSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'database' | 'extension' | 'file' | 'maintenance'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'extension'
      ? ObjectIndexIcon
      : icon === 'file'
        ? ObjectDocumentIcon
        : icon === 'maintenance'
          ? ObjectJobIcon
          : ObjectDatabaseIcon

  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function DuckDbChipRow({
  rows,
  labelKey,
  valueKey,
  limit,
}: {
  rows: JsonRecord[]
  labelKey: string
  valueKey: string
  limit: number
}) {
  const chips = rows
    .map((row) => ({
      label: displayValue(row[labelKey]),
      value: displayValue(row[valueKey]),
    }))
    .filter((chip) => chip.label)
    .slice(0, limit)

  if (!chips.length) {
    return null
  }

  return (
    <div className="object-view-chip-row">
      {chips.map((chip) => (
        <span key={`${chip.label}:${chip.value}`}>
          {chip.label}
          {chip.value ? (
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

function card(label: string, value: unknown) {
  return (
    <div className="object-view-card" key={label}>
      <span>{label}</span>
      <strong>{displayValue(value) || '-'}</strong>
    </div>
  )
}

function records(value: unknown) {
  return (Array.isArray(value) ? value : []).filter(isRecord)
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstPragma(rows: JsonRecord[], name: string) {
  const row = rows.find((item) => displayValue(item.name).toLowerCase() === name.toLowerCase())
  return firstDisplay(row?.value)
}

function firstField(rows: JsonRecord[], key: string) {
  return firstDisplay(...rows.map((row) => row[key]))
}

function firstDisplay(...values: unknown[]) {
  return values.find((value) => displayValue(value))
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return String(value)
}

function engineScope(kind: string) {
  return kind === 'table' || kind === 'view' ? 'object' : 'database'
}
