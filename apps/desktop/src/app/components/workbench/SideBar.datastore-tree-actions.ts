import type { ConnectionTreeAction } from './SideBar.datastore-tree-registry'

export function objectViewAction(
  id: string,
  label: string,
  objectViewKind: string,
  objectViewNodeId: string,
  objectViewPath?: string[],
  separatorBefore = false,
): ConnectionTreeAction {
  return {
    id,
    label,
    command: 'open-object-view',
    objectViewKind,
    objectViewNodeId,
    objectViewLabel: label.replace(/\.\.\.$/, ''),
    objectViewPath,
    separatorBefore,
  }
}
