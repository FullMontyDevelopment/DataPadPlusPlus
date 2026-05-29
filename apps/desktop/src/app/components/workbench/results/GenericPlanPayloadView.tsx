import type { ComponentType, CSSProperties } from 'react'
import type { ConnectionProfile, ResultPayload } from '@datapadplusplus/shared-types'
import { ExplainIcon, ObjectJobIcon, ObjectTableIcon, WarningIcon } from '../icons'
import { JsonTreeView } from './JsonTreeView'
import {
  normalizeGenericPlanPayload,
  type PlanTable,
} from './generic-plan-payload'

type PlanPayload = Extract<ResultPayload, { renderer: 'plan' }>

export function GenericPlanPayloadView({
  connection,
  payload,
}: {
  connection?: ConnectionProfile
  payload: PlanPayload
}) {
  const model = normalizeGenericPlanPayload(payload.value)
  const engine = engineLabel(connection?.engine)

  return (
    <section className="mongo-explain" aria-label="Execution plan">
      <header className="mongo-explain-header">
        <div>
          <span className="mongo-explain-eyebrow">
            <ExplainIcon className="panel-inline-icon" />
            {engine ? `${engine} Plan` : 'Execution Plan'}
          </span>
          <h3>{payload.summary ?? 'Execution plan'}</h3>
        </div>
        <span className="mongo-explain-verbosity">{payload.format}</span>
      </header>

      <div className="mongo-explain-summary-grid" aria-label="Execution plan summary">
        <PlanCard label="Format" value={payload.format.toUpperCase()} icon={ExplainIcon} />
        <PlanCard label="Plan Steps" value={String(model.lines.length || model.table?.rows.length || 0)} icon={ObjectJobIcon} />
        <PlanCard label="Table Rows" value={String(model.table?.rows.length ?? 0)} icon={ObjectTableIcon} />
        <PlanCard label="Signals" value={String(model.warnings.length)} icon={WarningIcon} />
      </div>

      {model.warnings.length ? (
        <div className="mongo-explain-warning-strip" role="note" aria-label="Execution plan warnings">
          {model.warnings.map((warning) => (
            <span key={warning}>
              <WarningIcon className="panel-inline-icon" />
              {warning}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mongo-explain-layout mongo-explain-layout--single">
        {model.lines.length ? <PlanLines lines={model.lines} /> : null}
        {model.table ? <PlanTableView table={model.table} /> : null}
        {!model.lines.length && !model.table ? (
          <div className="mongo-explain-panel">
            <header className="mongo-explain-section-header">
              <strong>Plan Details</strong>
              <span>Structured</span>
            </header>
            <JsonTreeView value={payload.value} label="plan" />
          </div>
        ) : model.raw !== undefined ? (
          <details className="mongo-explain-panel mongo-explain-raw-details generic-plan-raw">
            <summary>View structured plan payload</summary>
            <JsonTreeView value={model.raw} label="plan" />
          </details>
        ) : null}
      </div>
    </section>
  )
}

function PlanCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="mongo-explain-card">
      <Icon className="mongo-explain-card-icon" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PlanLines({ lines }: { lines: string[] }) {
  return (
    <section className="mongo-explain-panel mongo-explain-panel--tree">
      <header className="mongo-explain-section-header">
        <strong>Plan Steps</strong>
        <span>{lines.length} line(s)</span>
      </header>
      {lines.map((line, index) => (
        <div
          className="mongo-explain-node"
          key={`${line}-${index}`}
          style={{ '--plan-depth': String(planDepth(line)) } as CSSProperties}
        >
          <div className="mongo-explain-node-main">
            <span className={`mongo-explain-stage mongo-explain-stage--${stageTone(line)}`}>
              {stageLabel(line)}
            </span>
            <strong>{cleanPlanLine(line)}</strong>
          </div>
        </div>
      ))}
    </section>
  )
}

function PlanTableView({ table }: { table: PlanTable }) {
  return (
    <section className="mongo-explain-panel">
      <header className="mongo-explain-section-header">
        <strong>Plan Table</strong>
        <span>{table.rows.length} row(s)</span>
      </header>
      <table className="mongo-explain-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${row.join('|')}-${rowIndex}`}>
              {table.columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function stageTone(line: string) {
  if (/(index|seek|ixscan)/i.test(line)) return 'good'
  if (/(scan|seq scan|full scan|collscan)/i.test(line)) return 'warn'
  if (/(sort|join|aggregate|hash|nested)/i.test(line)) return 'caution'
  return 'muted'
}

function stageLabel(line: string) {
  const cleaned = cleanPlanLine(line)
  const match = cleaned.match(/[A-Z][A-Z0-9_ ]{2,}|[A-Za-z]+(?:Scan|Join|Sort|Aggregate|Projection|Filter|Limit|Read)/)
  return (match?.[0] ?? 'STEP').trim().slice(0, 24)
}

function planDepth(line: string) {
  const prefix = line.match(/^[\s|>+-]*/)?.[0] ?? ''
  return Math.min(8, Math.floor(prefix.length / 2))
}

function cleanPlanLine(line: string) {
  return line.replace(/^[\s|>+-]+/, '').trim() || line.trim()
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function engineLabel(engine: string | undefined) {
  if (!engine) return ''
  if (engine === 'duckdb') return 'DuckDB'
  if (engine === 'clickhouse') return 'ClickHouse'
  if (engine === 'bigquery') return 'BigQuery'
  if (engine === 'snowflake') return 'Snowflake'
  if (engine === 'sqlite') return 'SQLite'
  if (engine === 'sqlserver') return 'SQL Server'
  if (engine === 'postgresql') return 'PostgreSQL'
  if (engine === 'cockroachdb') return 'CockroachDB'
  return humanize(engine)
}
