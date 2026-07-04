export const CONNECTION_OBJECT_ROOT_PARENT_KEY = '__root__'

export function explorerFolderOrderKey(
  connectionId: string,
  environmentId: string | undefined,
  parentNodeKey: string,
) {
  return [
    'connection-object-tree',
    connectionId.trim(),
    environmentId?.trim() || 'default',
    parentNodeKey.trim() || CONNECTION_OBJECT_ROOT_PARENT_KEY,
  ].join('\u001f')
}
