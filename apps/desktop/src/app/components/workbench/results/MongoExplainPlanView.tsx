import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { ResultPayload } from '@datapadplusplus/shared-types'
import {
  ClockIcon,
  ExplainIcon,
  ObjectIndexIcon,
  ObjectTableIcon,
  WarningIcon,
} from '../icons'
import { JsonTreeView } from './JsonTreeView'
import {
  formatNumber,
  normalizeMongoExplainPlan,
  type MongoExplainIndexDetail,
  type MongoExplainPlanNode,
  type MongoExplainSummary,
} from './mongo-explain-plan'

type PlanPayload = Extract<ResultPayload, { renderer: 'plan' }>

export function MongoExplainPlanView({ payload }: { payload: PlanPayload }) {
  const model = useMemo(() => normalizeMongoExplainPlan(payload.value), [payload.value])

  return (
    <section className="mongo-explain" aria-label="MongoDB explain plan">
      <header className="mongo-explain-header">
        <div>
          <span className="mongo-explain-eyebrow">
            <ExplainIcon className="panel-inline-icon" />
            MongoDB Explain
          </span>
          <h3>{payload.summary ?? 'Query performance plan'}</h3>
        </div>
        <span className="mongo-explain-verbosity">{model.summary.verbosity}</span>
      </header>

      <SummaryGrid summary={model.summary} />

      {model.warnings.length > 0 ? (
        <div className="mongo-explain-warning-strip" role="note" aria-label="Explain plan warnings">
          {model.warnings.map((warning) => (
            <span key={warning}>
              <WarningIcon className="panel-inline-icon" />
              {warning}
            </span>
          ))}
        </div>
      ) : null}

      {model.fallbackReason && !model.winningPlan ? (
        <div className="mongo-explain-panel">
          <header className="mongo-explain-section-header">
            <strong>Explain details</strong>
            <span>{model.fallbackReason}</span>
          </header>
          <p className="panel-footnote">
            DataPad++ could not map this explain shape into the visual plan dashboard. The
            original sections are still available for troubleshooting.
          </p>
          <details className="mongo-explain-raw-details">
            <summary>View unparsed details</summary>
            <JsonTreeView value={model.raw} label="explain" />
          </details>
        </div>
      ) : null}

      {model.winningPlan ? (
        <div className="mongo-explain-layout">
          <section className="mongo-explain-panel mongo-explain-panel--tree">
            <header className="mongo-explain-section-header">
              <strong>Winning Plan</strong>
              <span>{model.summary.winningStage ?? 'Unknown stage'}</span>
            </header>
            <PlanNodeView node={model.winningPlan} depth={0} />
          </section>

          <aside className="mongo-explain-side">
            <IndexDetails details={model.indexDetails} />
            <RejectedPlans plans={model.rejectedPlans} />
          </aside>
        </div>
      ) : null}
    </section>
  )
}

export function GenericPlanPayloadView({ payload }: { payload: PlanPayload }) {
  return (
    <section className="mongo-explain" aria-label="Execution plan">
      <header className="mongo-explain-header">
        <div>
          <span className="mongo-explain-eyebrow">
            <ExplainIcon className="panel-inline-icon" />
            Execution Plan
          </span>
          <h3>{payload.summary ?? 'Execution plan'}</h3>
        </div>
        <span className="mongo-explain-verbosity">{payload.format}</span>
      </header>
      <div className="mongo-explain-panel">
        {payload.format === 'text' ? (
          <pre className="panel-code raw-result-code">{String(payload.value ?? '')}</pre>
        ) : (
          <JsonTreeView value={payload.value} label="plan" />
        )}
      </div>
    </section>
  )
}

function SummaryGrid({ summary }: { summary: MongoExplainSummary }) {
  const cards = [
    { label: 'Namespace', value: summary.namespace ?? 'Unknown', icon: ObjectTableIcon },
    { label: 'Winning strategy', value: summary.winningStage ?? 'Unknown', icon: ExplainIcon },
    { label: 'Index', value: summary.indexName ?? 'None reported', icon: ObjectIndexIcon },
    { label: 'Runtime', value: durationLabel(summary.executionTimeMs), icon: ClockIcon },
    { label: 'Returned', value: numberLabel(summary.returned), icon: ExplainIcon },
    { label: 'Docs examined', value: numberLabel(summary.docsExamined), icon: ExplainIcon },
    { label: 'Keys examined', value: numberLabel(summary.keysExamined), icon: ObjectIndexIcon },
    { label: 'Docs / returned', value: ratioLabel(summary.docsPerReturned), icon: WarningIcon },
  ]

  return (
    <div className="mongo-explain-summary-grid" aria-label="MongoDB explain summary">
      {cards.map(({ icon: Icon, label, value }) => (
        <article key={label} className="mongo-explain-card">
          <Icon className="mongo-explain-card-icon" />
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  )
}

function PlanNodeView({ depth, node }: { depth: number; node: MongoExplainPlanNode }) {
  return (
    <div className="mongo-explain-node" style={{ '--plan-depth': depth } as CSSProperties}>
      <div className="mongo-explain-node-main">
        <span className={`mongo-explain-stage mongo-explain-stage--${stageTone(node.stage)}`}>
          {node.stage}
        </span>
        {node.indexName ? <strong>{node.indexName}</strong> : null}
        {node.collection ? <span>{node.collection}</span> : null}
        {node.direction ? <span>{node.direction}</span> : null}
      </div>
      {node.metrics.length > 0 ? (
        <div className="mongo-explain-node-metrics">
          {node.metrics.map((metric) => (
            <span key={`${node.id}-${metric.label}`}>
              {metric.label}: <b>{metric.value}</b>
            </span>
          ))}
        </div>
      ) : null}
      {node.warnings.length > 0 ? (
        <div className="mongo-explain-node-warnings">
          {node.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      {node.filter || node.keyPattern || node.indexBounds ? (
        <div className="mongo-explain-node-details">
          {node.keyPattern ? <DetailChip label="Key" value={node.keyPattern} /> : null}
          {node.indexBounds ? <DetailChip label="Bounds" value={node.indexBounds} /> : null}
          {node.filter ? <DetailChip label="Filter" value={node.filter} /> : null}
        </div>
      ) : null}
      <details className="mongo-explain-raw-details">
        <summary>View stage details</summary>
        <JsonTreeView value={node.raw} label={node.stage} />
      </details>
      {node.children.map((child) => (
        <PlanNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function DetailChip({ label, value }: { label: string; value: unknown }) {
  return (
    <span title={stringifyCompact(value)}>
      <b>{label}</b>
      {stringifyCompact(value)}
    </span>
  )
}

function IndexDetails({ details }: { details: MongoExplainIndexDetail[] }) {
  return (
    <section className="mongo-explain-panel">
      <header className="mongo-explain-section-header">
        <strong>Index Usage</strong>
        <span>{details.length} index(es)</span>
      </header>
      {details.length === 0 ? (
        <p className="panel-footnote">No index metadata was reported for the winning plan.</p>
      ) : (
        <table className="mongo-explain-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Stage</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {details.map((detail) => (
              <tr key={`${detail.stage}-${detail.name}`}>
                <td>
                  <strong>{detail.name}</strong>
                  {detail.direction ? <span>{detail.direction}</span> : null}
                </td>
                <td>{detail.stage}</td>
                <td>{indexFlags(detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function RejectedPlans({ plans }: { plans: MongoExplainPlanNode[] }) {
  return (
    <section className="mongo-explain-panel">
      <header className="mongo-explain-section-header">
        <strong>Rejected Plans</strong>
        <span>{plans.length} shown</span>
      </header>
      {plans.length === 0 ? (
        <p className="panel-footnote">No rejected plans were returned.</p>
      ) : (
        <div className="mongo-explain-rejected-list">
          {plans.map((plan) => (
            <article key={plan.id} className="mongo-explain-rejected-card">
              <span className={`mongo-explain-stage mongo-explain-stage--${stageTone(plan.stage)}`}>
                {plan.stage}
              </span>
              <strong>{plan.indexName ?? 'No index'}</strong>
              {plan.metrics.slice(0, 3).map((metric) => (
                <span key={metric.label}>{metric.label}: {metric.value}</span>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function stageTone(stage: string) {
  if (stage.includes('COLLSCAN')) {
    return 'warn'
  }
  if (stage.includes('IXSCAN') || stage.includes('IDHACK')) {
    return 'good'
  }
  if (stage.includes('SORT')) {
    return 'caution'
  }
  if (stage === 'TRUNCATED') {
    return 'muted'
  }
  return 'default'
}

function indexFlags(detail: MongoExplainIndexDetail) {
  const flags = [
    detail.multikey ? 'multikey' : undefined,
    detail.sparse ? 'sparse' : undefined,
    detail.partial ? 'partial' : undefined,
  ].filter(Boolean)
  return flags.length > 0 ? flags.join(', ') : 'standard'
}

function durationLabel(value: number | undefined) {
  return value === undefined ? 'No stats' : `${formatNumber(value)} ms`
}

function numberLabel(value: number | undefined) {
  return value === undefined ? 'No stats' : formatNumber(value)
}

function ratioLabel(value: number | undefined) {
  return value === undefined ? 'No stats' : formatNumber(value)
}

function stringifyCompact(value: unknown) {
  if (value === undefined) {
    return ''
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
