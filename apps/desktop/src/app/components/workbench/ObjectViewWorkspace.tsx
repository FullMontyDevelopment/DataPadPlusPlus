import { GenericObjectViewWorkspace } from './GenericObjectViewWorkspace'
import { workbenchSliceForEngine } from './datastores/registry'
import type { ObjectViewWorkspaceProps } from './datastores/types'

export function ObjectViewWorkspace(props: ObjectViewWorkspaceProps) {
  const SliceObjectViewWorkspace =
    workbenchSliceForEngine(props.connection.engine)?.objectViewWorkspace

  if (SliceObjectViewWorkspace) {
    return <SliceObjectViewWorkspace {...props} />
  }

  return (
    <GenericObjectViewWorkspace
      connection={props.connection}
      environment={props.environment}
      tab={props.tab}
      onRefresh={props.onRefresh}
    />
  )
}
