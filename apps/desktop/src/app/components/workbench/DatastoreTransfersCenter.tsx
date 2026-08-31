import type { DatastoreTransferJob } from '@datapadplusplus/shared-types'
import {
  CloseIcon,
  ConnectionConnectedIcon,
  DownloadIcon,
  HistoryIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'

interface DatastoreTransfersCenterProps {
  jobs: DatastoreTransferJob[]
  onClose(): void
  onDismiss(jobId: string): void
  onRetry(jobId: string): void
}

export function DatastoreTransfersCenter({
  jobs,
  onClose,
  onDismiss,
  onRetry,
}: DatastoreTransfersCenterProps) {
  return (
    <aside className="datastore-transfers-center" aria-label="Datastore transfers">
      <header>
        <div><HistoryIcon /><span><strong>Transfers</strong><small>{jobs.length ? transferSummary(jobs) : 'No transfers this session'}</small></span></div>
        <button type="button" aria-label="Close Transfers Center" title="Close" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="datastore-transfers-list">
        {jobs.length ? jobs.map((job) => (
          <article key={job.id} className={`datastore-transfer-job is-${job.status}`}>
            <span className="datastore-transfer-job-icon" aria-hidden="true">{jobIcon(job)}</span>
            <div className="datastore-transfer-job-copy">
              <strong>{capitalize(job.action)} {job.objectNames[0] || job.engine}</strong>
              <span>{job.fileName || job.formatId} · {capitalize(job.status)}</span>
              {job.error ? <small role="alert">{job.error}</small> : job.warnings[0] ? <small>{job.warnings[0]}</small> : null}
            </div>
            <div className="datastore-transfer-job-actions">
              {job.status === 'failed' ? (
                <button type="button" aria-label={`Retry ${job.action}`} title="Retry" onClick={() => onRetry(job.id)}><RefreshIcon /></button>
              ) : null}
              {job.status !== 'running' && job.status !== 'queued' ? (
                <button type="button" aria-label={`Dismiss ${job.action}`} title="Dismiss" onClick={() => onDismiss(job.id)}><CloseIcon /></button>
              ) : null}
            </div>
          </article>
        )) : (
          <div className="datastore-transfers-empty"><DownloadIcon /><p>Started imports, exports, backups, and restores will appear here.</p></div>
        )}
      </div>
    </aside>
  )
}

function jobIcon(job: DatastoreTransferJob) {
  if (job.status === 'completed') return <ConnectionConnectedIcon />
  if (job.status === 'failed' || job.status === 'canceled') return <WarningIcon />
  return <RefreshIcon className="is-spinning" />
}

function transferSummary(jobs: DatastoreTransferJob[]) {
  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length
  if (active) return `${active} active`
  const failed = jobs.filter((job) => job.status === 'failed').length
  if (failed) return `${failed} need attention`
  return `${jobs.length} completed`
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
