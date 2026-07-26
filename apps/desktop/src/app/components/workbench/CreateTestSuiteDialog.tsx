import { useEffect, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { datastoreTestTemplatesForEngine } from '@datapadplusplus/shared-types'
import { DatastoreIcon } from './DatastoreIcon'
import { explorerNodeTarget } from './SideBar.helpers'
import { QueryTargetPicker } from './query-targets/QueryTargetPicker'
import {
  normalizeKind,
  queryTargetRegistryForEngine,
} from './query-targets/query-target-registry'
import {
  datastoreTestTargetBreadcrumb,
  datastoreTestTargetNodes,
  datastoreTestTargetProviderForConnection,
  inferredDatastoreTestLanguage,
  validateDatastoreTestTarget,
} from './query-targets/test-suite-target-registry'

export interface CreateTestSuiteDialogRequest {
  connectionId?: string
  environmentId?: string
  templateId?: string
  scopedTarget?: ScopedQueryTarget
}

export function CreateTestSuiteDialog({
  connections,
  environments,
  explorerError,
  getExplorerNodes,
  getExplorerStatus,
  initialRequest,
  isExplorerScopeLoaded,
  isExplorerScopeLoading,
  onCancel,
  onCreate,
  onLoadExplorerScope,
}: {
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  explorerError?: string
  getExplorerNodes(connectionId: string, environmentId: string): ExplorerNode[]
  getExplorerStatus(
    connectionId: string,
    environmentId: string,
  ): 'idle' | 'loading' | 'ready'
  initialRequest: CreateTestSuiteDialogRequest
  isExplorerScopeLoaded(
    connectionId: string,
    environmentId: string,
    scope?: string,
  ): boolean
  isExplorerScopeLoading(
    connectionId: string,
    environmentId: string,
    scope?: string,
  ): boolean
  onCancel(): void
  onCreate(request: {
    connectionId: string
    environmentId: string
    scopedTarget: ScopedQueryTarget
    templateId?: string
  }): void
  onLoadExplorerScope(
    connectionId: string,
    environmentId: string,
    scope?: string,
  ): void
}) {
  const connection =
    connections.find((connection) => connection.id === initialRequest.connectionId) ??
    connections[0]
  const availableEnvironments = connection
    ? environments.filter((environment) =>
        connection.environmentIds.includes(environment.id),
      )
    : []
  const environment =
    availableEnvironments.find(
      (environment) => environment.id === initialRequest.environmentId,
    ) ?? availableEnvironments[0]
  const environmentId = environment?.id ?? ''
  const [scopedTarget, setScopedTarget] = useState<ScopedQueryTarget | undefined>(
    initialRequest.scopedTarget,
  )
  const [templateId, setTemplateId] = useState(initialRequest.templateId ?? '')
  const provider = connection
    ? datastoreTestTargetProviderForConnection(connection)
    : undefined
  const liveExplorerNodes =
    connection && environmentId
      ? getExplorerNodes(connection.id, environmentId)
      : []
  const discoveredDatabaseNode = liveExplorerNodes.find(
    (node) =>
      ['database', 'catalog'].includes(normalizeKind(node.kind)) &&
      provider?.acceptedTargetKinds.has('database'),
  )
  const connectionTarget =
    connection && discoveredDatabaseNode
      ? explorerNodeTarget(discoveredDatabaseNode, connection)
      : connection && provider?.connectionTarget
        ? provider.connectionTarget(connection)
      : undefined
  const pickerTarget =
    connection && scopedTarget && queryTargetRegistryForEngine(connection.engine).levels
      .some((level) => level.kinds.includes(normalizeKind(scopedTarget.kind)))
      ? scopedTarget
      : undefined
  const explorerNodes =
    connection && environmentId
      ? datastoreTestTargetNodes(
          connection,
          liveExplorerNodes,
        )
      : []
  const explorerStatus =
    connection && environmentId
      ? getExplorerStatus(connection.id, environmentId)
      : 'idle'
  const templates = connection
    ? datastoreTestTemplatesForEngine(connection.engine, connection.family)
    : []
  const targetError = connection
    ? validateDatastoreTestTarget(connection, scopedTarget)
    : 'Choose a datastore connection.'
  const canCreate = Boolean(
    connection &&
    environmentId &&
    scopedTarget &&
    !targetError,
  )

  useEffect(() => {
    if (connection && environmentId && explorerStatus === 'idle') {
      onLoadExplorerScope(connection.id, environmentId)
    }
  }, [connection, environmentId, explorerStatus, onLoadExplorerScope])

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog create-test-suite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-test-suite-dialog-title"
      >
        <p className="sidebar-eyebrow">Datastore Tests</p>
        <h2 id="create-test-suite-dialog-title">Create target-bound test suite</h2>

        <div className="create-test-suite-fields">
          <label className="test-field">
            <span>Template</span>
            <select
              aria-label="Test suite template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Custom suite</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {connection ? (
          <div className="create-test-suite-target">
            <div className="create-test-suite-target-heading">
              <DatastoreIcon decorative engine={connection.engine} />
              <div>
                <strong>Datastore target</strong>
                <span>
                  {connection.name} · {environment?.label ?? environmentId} ·{' '}
                  {inferredDatastoreTestLanguage(connection)}
                </span>
              </div>
            </div>
            {provider ? (
              <>
                {connectionTarget ? (
                  <button
                    type="button"
                    className={`create-test-suite-database-target${
                      scopedTarget?.kind === connectionTarget.kind &&
                      scopedTarget.label === connectionTarget.label
                        ? ' is-selected'
                        : ''
                    }`}
                    onClick={() => setScopedTarget(connectionTarget)}
                  >
                    <strong>Use database scope</strong>
                    <span>{connectionTarget.label}</span>
                  </button>
                ) : null}
                <QueryTargetPicker
                  builderState={undefined}
                  connection={connection}
                  disabled={!environmentId}
                  error={explorerError}
                  floatingMenu
                  isScopeLoaded={(scope) =>
                    isExplorerScopeLoaded(connection.id, environmentId, scope)
                  }
                  isScopeLoading={(scope) =>
                    isExplorerScopeLoading(connection.id, environmentId, scope)
                  }
                  nodes={explorerNodes}
                  onChange={setScopedTarget}
                  onLoadScope={(scope) =>
                    onLoadExplorerScope(connection.id, environmentId, scope)
                  }
                  onRefresh={() =>
                    onLoadExplorerScope(connection.id, environmentId)
                  }
                  scopedTarget={pickerTarget}
                  selectableLevelIds={provider.selectableLevelIds}
                />
              </>
            ) : (
              <p className="create-test-suite-blocker">
                {connection.name} does not expose a validated datastore test target.
              </p>
            )}
            {explorerStatus === 'loading' ? (
              <p className="create-test-suite-state" role="status">
                Loading live datastore targets…
              </p>
            ) : null}
            {provider && scopedTarget ? (
              <p className="create-test-suite-selection">
                <strong>{scopedTarget.kind}</strong>
                <span>{datastoreTestTargetBreadcrumb(scopedTarget)}</span>
              </p>
            ) : provider ? (
              <p className="create-test-suite-state">{targetError}</p>
            ) : null}
          </div>
        ) : null}

        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={!canCreate}
            onClick={() => {
              if (!connection || !environmentId || !scopedTarget) {
                return
              }
              onCreate({
                connectionId: connection.id,
                environmentId,
                scopedTarget,
                templateId: templateId || undefined,
              })
            }}
          >
            Create Test Suite
          </button>
        </div>
      </section>
    </div>
  )
}
