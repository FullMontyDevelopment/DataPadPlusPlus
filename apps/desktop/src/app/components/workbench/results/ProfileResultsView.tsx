import type { ResultPayload } from '@datapadplusplus/shared-types'
import { ExplainIcon, ObjectJobIcon } from '../icons'

type ProfilePayload = Extract<ResultPayload, { renderer: 'profile' }>

export function ProfileResultsView({ payload }: { payload: ProfilePayload }) {
  const stages = Array.isArray(payload.stages) ? payload.stages : []
  const totalDuration = stages.reduce((total, stage) => total + safeNumber(stage.durationMs), 0)
  const totalRows = stages.reduce((total, stage) => total + safeNumber(stage.rows), 0)

  return (
    <section className="profile-result-view" aria-label="Query profile">
      <header className="profile-result-header">
        <div>
          <span>
            <ExplainIcon className="panel-inline-icon" />
            Profile
          </span>
          <strong>{payload.summary ?? 'Execution profile'}</strong>
        </div>
        <div className="profile-result-summary">
          <span>{formatDuration(totalDuration)}</span>
          <span>{totalRows ? `${totalRows.toLocaleString()} row(s)` : `${stages.length} stage(s)`}</span>
        </div>
      </header>

      {stages.length ? (
        <div className="profile-stage-list">
          {stages.map((stage, index) => (
            <article className="profile-stage" key={`${stage.name}-${index}`}>
              <div className="profile-stage-marker">
                <ObjectJobIcon className="panel-inline-icon" />
              </div>
              <div className="profile-stage-body">
                <div className="profile-stage-title">
                  <strong>{stage.name}</strong>
                  <span>{formatDuration(stage.durationMs)}</span>
                  {stage.rows !== undefined ? <span>{stage.rows.toLocaleString()} row(s)</span> : null}
                </div>
                <ProfileStageDetails details={stage.details} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="panel-footnote">No profile stages were returned.</p>
      )}
    </section>
  )
}

function ProfileStageDetails({ details }: { details?: Record<string, unknown> }) {
  const entries = Object.entries(details ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!entries.length) {
    return null
  }

  return (
    <div className="profile-stage-details">
      {entries.slice(0, 8).map(([key, value]) => (
        <span key={key}>
          {humanize(key)}
          {': '}
          <strong>{displayValue(value)}</strong>
        </span>
      ))}
    </div>
  )
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatDuration(value: unknown) {
  const duration = safeNumber(value)
  if (duration <= 0) {
    return '0 ms'
  }

  return duration >= 1000 ? `${(duration / 1000).toFixed(2)} s` : `${duration.toFixed(1)} ms`
}

function displayValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }

  if (value && typeof value === 'object') {
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  }

  return String(value)
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
