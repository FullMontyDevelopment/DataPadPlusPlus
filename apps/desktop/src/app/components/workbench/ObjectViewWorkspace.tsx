import { workbenchSliceForEngine } from './datastores/registry'
import type { ObjectViewWorkspaceProps } from './datastores/types'

export function ObjectViewWorkspace(props: ObjectViewWorkspaceProps) {
  const provider = workbenchSliceForEngine(props.connection.engine).objectView
  const ProviderWorkspace = provider.Workspace
  return <ProviderWorkspace {...props} />
}
