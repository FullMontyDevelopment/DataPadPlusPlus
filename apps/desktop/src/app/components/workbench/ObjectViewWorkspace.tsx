import { workbenchSliceForEngine } from './datastores/registry'
import type { ObjectViewWorkspaceProps } from './datastores/types'

export function ObjectViewWorkspace(props: ObjectViewWorkspaceProps) {
  const provider = workbenchSliceForEngine(props.connection.engine).objectView
  const ProviderWorkspace = provider.Workspace
  return (
    <>
      {props.tab.objectViewState?.refreshRequired ? (
        <div className="object-view-warning-list" role="status">
          <div className="object-view-warning">Refresh to load current data.</div>
        </div>
      ) : null}
      <ProviderWorkspace {...props} />
    </>
  )
}
