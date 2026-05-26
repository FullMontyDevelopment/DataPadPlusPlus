import type { ReactNode } from 'react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { RefreshIcon } from './icons'
import { ExplorerNodeIcon } from './SideBar.node-icons'

export function ObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ExplorerNodeIcon connection={connection} kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>
            {[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
