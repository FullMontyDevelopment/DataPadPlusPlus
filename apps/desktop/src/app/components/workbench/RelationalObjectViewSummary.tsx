import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectRelationshipIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from './icons'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'
import {
  displaySummaryValue,
  relationshipRows,
  summaryStats,
  type SummaryIcon,
} from './RelationalObjectViewSummary.helpers'

interface RelationalObjectViewSummaryProps {
  connection: ConnectionProfile
  kind: string
  payload: JsonRecord
}

export function RelationalObjectViewSummary({
  connection,
  kind,
  payload,
}: RelationalObjectViewSummaryProps) {
  const stats = summaryStats(kind, payload)
  const relationships = relationshipRows(payload).slice(0, 4)
  const database = displaySummaryValue(payload.database ?? payload.databaseName)
  const schema = displaySummaryValue(payload.schema ?? payload.schemaName)
  const objectName = displaySummaryValue(payload.objectName ?? payload.tableName ?? payload.viewName ?? payload.routineName)

  if (!stats.length && !relationships.length) {
    return null
  }

  return (
    <section className="object-view-section relational-summary" aria-label="SQL object summary">
      <div className="relational-summary-identity">
        <span>{engineLabel(connection)}</span>
        {database ? <strong>{database}</strong> : null}
        {schema ? <strong>{schema}</strong> : null}
        {objectName ? <strong>{objectName}</strong> : null}
      </div>

      {stats.length ? (
        <div className="relational-summary-grid">
          {stats.map((stat) => (
            <div className="relational-summary-stat" key={`${stat.label}:${stat.value}`}>
              <SummaryIconView icon={stat.icon} />
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {relationships.length ? (
        <div className="relational-summary-links" aria-label="Object relationships">
          {relationships.map((relationship) => (
            <span key={`${relationship.from}:${relationship.to}:${relationship.name}`}>
              <ObjectRelationshipIcon className="panel-inline-icon" />
              <strong>{relationship.from}</strong>
              <span>{relationship.name}</span>
              <strong>{relationship.to}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function engineLabel(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') return 'SQL Server'
  if (connection.engine === 'postgresql') return 'PostgreSQL'
  if (connection.engine === 'cockroachdb') return 'CockroachDB'
  if (connection.engine === 'timescaledb') return 'TimescaleDB'
  if (connection.engine === 'mysql') return 'MySQL'
  if (connection.engine === 'mariadb') return 'MariaDB'
  if (connection.engine === 'sqlite') return 'SQLite'
  if (connection.engine === 'duckdb') return 'DuckDB'
  return connection.engine
}

function SummaryIconView({ icon }: { icon: SummaryIcon }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : icon === 'relationship'
            ? ObjectRelationshipIcon
            : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
}
