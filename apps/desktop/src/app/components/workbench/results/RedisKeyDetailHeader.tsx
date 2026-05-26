import type { KeyValuePayload } from '@datapadplusplus/shared-types'
import { ClockIcon, DownloadIcon, RenameIcon, TrashIcon, UnlockIcon, UploadIcon } from '../icons'

interface RedisKeyDetailHeaderProps {
  canEdit: boolean
  canPlanKeyOperation: boolean
  payload: KeyValuePayload
  onDelete(): void
  onImport(): void
  onExport(): void
  onPersistTtl(): void
  onRename(): void
  onSetTtl(): void
}

export function RedisKeyDetailHeader({
  canEdit,
  canPlanKeyOperation,
  onDelete,
  onExport,
  onImport,
  onPersistTtl,
  onRename,
  onSetTtl,
  payload,
}: RedisKeyDetailHeaderProps) {
  if (!payload.key) {
    return null
  }

  const redisType = payload.redisType ?? 'unknown'

  return (
    <div className="redis-key-detail-header">
      <div className="redis-key-detail-identity">
        <strong>{payload.key}</strong>
        <span className={`redis-type-badge is-${redisType}`}>
          {redisType}
        </span>
      </div>
      <span>{payload.ttl ?? 'TTL unavailable'}</span>
      <span>{payload.memoryUsage ?? 'Memory unavailable'}</span>
      {payload.encoding ? <span>{payload.encoding}</span> : null}
      {payload.length !== undefined ? <span>{payload.length} item(s)</span> : null}
      {canEdit || canPlanKeyOperation ? (
        <div className="redis-key-detail-actions">
          {canPlanKeyOperation ? (
            <>
              <button
                type="button"
                className="object-view-icon-action"
                aria-label={`Export key ${payload.key}`}
                title="Export key"
                onClick={onExport}
              >
                <DownloadIcon className="toolbar-icon" />
              </button>
              <button
                type="button"
                className="object-view-icon-action"
                aria-label={`Import key ${payload.key}`}
                title="Import key"
                onClick={onImport}
              >
                <UploadIcon className="toolbar-icon" />
              </button>
            </>
          ) : null}
          {canEdit ? (
            <>
              <button
                type="button"
                className="object-view-icon-action"
                aria-label={`Rename key ${payload.key}`}
                title="Rename key"
                onClick={onRename}
              >
                <RenameIcon className="toolbar-icon" />
              </button>
              <button
                type="button"
                className="object-view-icon-action"
                aria-label={`Set TTL for ${payload.key}`}
                title="Set TTL"
                onClick={onSetTtl}
              >
                <ClockIcon className="toolbar-icon" />
              </button>
              <button
                type="button"
                className="object-view-icon-action"
                aria-label={`Remove TTL for ${payload.key}`}
                title="Remove TTL"
                onClick={onPersistTtl}
              >
                <UnlockIcon className="toolbar-icon" />
              </button>
              <button
                type="button"
                className="object-view-icon-action is-danger redis-key-detail-delete"
                aria-label={`Delete key ${payload.key}`}
                title="Delete key"
                onClick={onDelete}
              >
                <TrashIcon className="toolbar-icon" />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
