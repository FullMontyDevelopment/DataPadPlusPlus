import {
  ObjectCollectionIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  RenameIcon,
  SettingsIcon,
  TrashIcon,
} from '../../icons'

export type MongoCollectionAdminOperation =
  | 'rename-collection'
  | 'drop-collection'
  | 'modify-collection'
  | 'convert-to-capped'
  | 'clone-as-capped'
  | 'compact-collection'
  | 'validate-collection'

export const mongoCollectionAdminActions: {
  description: string
  icon: typeof RenameIcon
  id: MongoCollectionAdminOperation
  label: string
  reviewLabel: string
}[] = [
  {
    id: 'rename-collection',
    label: 'Rename',
    reviewLabel: 'Review Rename',
    description: 'Rename this collection, optionally moving it into another database.',
    icon: RenameIcon,
  },
  {
    id: 'modify-collection',
    label: 'Modify',
    reviewLabel: 'Review Modify',
    description: 'Prepare a collMod operation for validation or collection options.',
    icon: SettingsIcon,
  },
  {
    id: 'convert-to-capped',
    label: 'Convert To Capped',
    reviewLabel: 'Review Convert',
    description: 'Convert this collection to capped storage with a fixed byte size.',
    icon: ObjectCollectionIcon,
  },
  {
    id: 'clone-as-capped',
    label: 'Clone As Capped',
    reviewLabel: 'Review Clone',
    description: 'Clone this collection into a new capped collection.',
    icon: PlusIcon,
  },
  {
    id: 'compact-collection',
    label: 'Compact',
    reviewLabel: 'Review Compact',
    description: 'Prepare a compact operation for this collection.',
    icon: RefreshIcon,
  },
  {
    id: 'validate-collection',
    label: 'Validate',
    reviewLabel: 'Review Validate',
    description: 'Validate collection metadata and documents.',
    icon: PlayIcon,
  },
  {
    id: 'drop-collection',
    label: 'Drop',
    reviewLabel: 'Review Drop',
    description: 'Prepare a guarded drop operation for this collection.',
    icon: TrashIcon,
  },
]

export function mongoCollectionAdminOperationFromNodeId(
  nodeId: string,
): MongoCollectionAdminOperation | undefined {
  if (!nodeId.startsWith('collection-admin:')) {
    return undefined
  }
  const operation = nodeId.slice('collection-admin:'.length).split(':')[0]
  return mongoCollectionAdminActions.some((action) => action.id === operation)
    ? operation as MongoCollectionAdminOperation
    : undefined
}
