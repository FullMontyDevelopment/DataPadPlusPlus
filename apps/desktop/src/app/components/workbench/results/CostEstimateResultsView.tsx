import type { ComponentType } from 'react'
import type { ResultPayload } from '@datapadplusplus/shared-types'
import { MetricsIcon, ObjectJobIcon, ObjectWarehouseIcon, WarningIcon } from '../icons'

type CostEstimatePayload = Extract<ResultPayload, { renderer: 'costEstimate' }>

export function CostEstimateResultsView({ payload }: { payload: CostEstimatePayload }) {
  const details = recordValue(payload.details)
  const bytes = optionalNumberValue(
    payload.estimatedBytes,
    details.estimatedBytes,
    details.bytesScanned,
    details.bytesProcessed,
  )
  const credits = optionalNumberValue(payload.estimatedCredits, details.estimatedCredits, details.credits)
  const cost = optionalNumberValue(payload.estimatedCost, details.estimatedCost)
  const currency = stringValue(payload.currency, details.currency) || 'USD'
  const rows = detailRows(details)
  const warnings = costWarnings(details, bytes)
  const priceSummary = costSummary(cost, credits, currency)

  return (
    <section className="cost-estimate-view" aria-label="Cost estimate">
      <header className="profile-result-header">
        <div>
          <span>
            <MetricsIcon className="panel-inline-icon" />
            Cost
          </span>
          <strong>{estimateTitle(details)}</strong>
        </div>
        <div className="profile-result-summary">
          <span>{bytes === null ? 'No byte estimate' : formatBytes(bytes)}</span>
          <span>{priceSummary}</span>
        </div>
      </header>

      <div className="mongo-explain-summary-grid" aria-label="Cost estimate summary">
        <CostCard label="Bytes" value={bytes === null ? 'Unknown' : formatBytes(bytes)} icon={ObjectWarehouseIcon} />
        <CostCard label="Cost" value={cost === null ? 'Not priced' : formatCurrency(cost, currency)} icon={MetricsIcon} />
        <CostCard label="Credits" value={credits === null ? '0' : formatNumber(credits)} icon={ObjectJobIcon} />
        <CostCard label="Mode" value={modeLabel(details)} icon={WarningIcon} />
      </div>

      {warnings.length ? (
        <div className="mongo-explain-warning-strip" role="note" aria-label="Cost estimate warnings">
          {warnings.map((warning) => (
            <span key={warning}>
              <WarningIcon className="panel-inline-icon" />
              {warning}
            </span>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="mongo-explain-layout mongo-explain-layout--single">
          <section className="mongo-explain-panel">
            <header className="mongo-explain-section-header">
              <strong>Estimate Details</strong>
              <span>{rows.length} field(s)</span>
            </header>
            <table className="mongo-explain-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td>{humanize(label)}</td>
                    <td>{displayValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function CostCard({
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

function detailRows(details: Record<string, unknown>) {
  const summaryKeys = new Set(['estimatedBytes', 'estimatedCredits', 'estimatedCost', 'currency'])
  return Object.entries(details).filter(
    ([key, value]) => !summaryKeys.has(key) && value !== undefined && value !== null && value !== '',
  )
}

function costSummary(cost: number | null, credits: number | null, currency: string) {
  if (cost !== null) return formatCurrency(cost, currency)
  if (credits !== null) return `${formatNumber(credits)} credit(s)`
  return 'Estimate only'
}

function estimateTitle(details: Record<string, unknown>) {
  const engine = stringValue(details.engine)
  if (engine === 'bigquery') return 'BigQuery dry-run estimate'
  if (engine === 'snowflake') return 'Snowflake scan estimate'
  if (engine === 'dynamodb') return 'DynamoDB capacity estimate'
  if (engine === 'cosmosdb') return 'Cosmos DB RU estimate'
  return 'Execution estimate'
}

function modeLabel(details: Record<string, unknown>) {
  if (details.dryRun === true || details.dryRunRequired === true) return 'Dry run'
  if (details.live === true || details.liveCosting === true) return 'Live'
  return 'Preview'
}

function costWarnings(details: Record<string, unknown>, bytes: number | null) {
  const warnings: string[] = []
  if (details.dryRunRequired === true) warnings.push('Run a dry-run or preview before execution.')
  if (details.live === false || details.liveCosting === false) warnings.push('Estimate is based on preview metadata.')
  if (bytes !== null && bytes >= 1024 ** 4) warnings.push('Large scan estimate.')
  return warnings
}

function optionalNumberValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[$,\s]/g, ''))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
}

function displayValue(value: unknown) {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return `${value.length} item(s)`
  if (value && typeof value === 'object') return `${Object.keys(value).length} field(s)`
  return String(value)
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
