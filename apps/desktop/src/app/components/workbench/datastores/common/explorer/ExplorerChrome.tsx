import type { CSSProperties, ReactNode } from 'react'
import type { ConnectionProfile, EnvironmentProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { DatastoreIcon } from '../../../DatastoreIcon'
import { ExplorerNodeIcon } from '../../../SideBar.node-icons'
import { humanize } from './DatastoreExplorerProvider.model'

export function ExplorerWorkspaceHeader({ connection, environment, label, children }: {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  label: string
  children: ReactNode
}) {
  return (
    <header className="explorer-workspace-header">
      <div className="explorer-workspace-identity">
        <DatastoreIcon engine={connection.engine} />
        <div className="explorer-workspace-title">
          <span className="explorer-workspace-label">{label} Explorer</span>
          <h1 title={connection.name}>{connection.name}</h1>
        </div>
        <span className="explorer-environment" style={{ '--explorer-environment-color': environment.color } as CSSProperties}>
          <span aria-hidden="true" />{environment.label}
        </span>
      </div>
      <div className="explorer-workspace-actions">{children}</div>
    </header>
  )
}

export function ExplorerSelectionHeader({ connection, node, description, actions, className = '', label = 'Selected object' }: {
  connection: ConnectionProfile
  node: ExplorerNode
  description?: string
  actions: ReactNode
  className?: string
  label?: string
}) {
  const path = [...(node.path ?? [])]
  if (path.at(-1) === node.label) path.pop()
  return (
    <section className={`explorer-selection-header ${className}`} aria-label={label}>
      {path.length ? (
        <nav aria-label="Object location" className="explorer-breadcrumb">
          <ol>{path.map((part, index) => <li key={`${index}:${part}`}>{part}</li>)}</ol>
        </nav>
      ) : null}
      <div className="explorer-selection-row">
        <span className="explorer-selection-icon"><ExplorerNodeIcon connection={connection} kind={node.kind} /></span>
        <div className="explorer-selection-title">
          <h2>{node.label}</h2>
          <span className="explorer-object-kind">{humanize(node.kind)}</span>
        </div>
        {actions}
      </div>
      {description ? <p className="explorer-selection-description">{description}</p> : null}
    </section>
  )
}
