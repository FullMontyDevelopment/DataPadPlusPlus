import type { ReactNode } from 'react'

export type MongoMetric = {
  label: string
  value: ReactNode
}

export function MongoContextStrip({
  eyebrow,
  title,
  detail,
  metrics = [],
}: {
  eyebrow: string
  title: string
  detail?: string
  metrics?: MongoMetric[]
}) {
  return (
    <section className="mongo-operational-summary">
      <header className="mongo-operational-summary-heading">
        <div>
          <span>{eyebrow}</span>
          <strong>{title}</strong>
        </div>
        {detail ? <p>{detail}</p> : null}
      </header>
      {metrics.length ? (
        <dl className="mongo-operational-metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

export function MongoResourceSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={['mongo-resource-section', className].filter(Boolean).join(' ')}>
      <header className="mongo-resource-section-header">
        <div>
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="mongo-resource-section-actions">{actions}</div> : null}
      </header>
      <div className="mongo-resource-section-body">{children}</div>
    </section>
  )
}

export function MongoGuardedSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mongo-guarded-section">
      <header>
        <div>
          <span>Guarded operations</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="mongo-guarded-section-actions">{children}</div>
    </section>
  )
}

export function MongoAdvancedDisclosure({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <details className="mongo-advanced-disclosure">
      <summary>
        <span>
          <strong>{label}</strong>
          {description ? <small>{description}</small> : null}
        </span>
      </summary>
      <div className="mongo-advanced-disclosure-body">{children}</div>
    </details>
  )
}

