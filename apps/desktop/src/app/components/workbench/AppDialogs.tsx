import { useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  LibraryNode,
  QueryTabState,
} from '@datapadplusplus/shared-types'

export function CloseSavedTabDialog({
  tab,
  onCancel,
  onDiscard,
  onSaveAndClose,
}: {
  tab: QueryTabState
  onCancel(): void
  onDiscard(): void
  onSaveAndClose(): void
}) {
  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-tab-dialog-title"
      >
        <p className="sidebar-eyebrow">Unsaved Library Item</p>
        <h2 id="close-tab-dialog-title">Save changes before closing?</h2>
        <p>
          {tab.title} has edits that are not saved to its Library item or local
          file. Ephemeral tabs close immediately, but saved items need an
          explicit choice.
        </p>
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="drawer-button" onClick={onDiscard}>
            Discard Changes
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={onSaveAndClose}
          >
            Save and Close
          </button>
        </div>
      </section>
    </div>
  )
}

export function SaveQueryDialog({
  libraryNodes,
  tab,
  onCancel,
  onSaveLocal,
  onSaveToLibrary,
}: {
  libraryNodes: LibraryNode[]
  tab: QueryTabState
  onCancel(): void
  onSaveLocal(): void
  onSaveToLibrary(request: {
    folderId: string
    itemId?: string
    name: string
  }): void
}) {
  const folders = useMemo(
    () =>
      libraryNodes
        .filter((node) => node.kind === 'folder')
        .sort((left, right) =>
          libraryNodePath(libraryNodes, left).localeCompare(
            libraryNodePath(libraryNodes, right),
          ),
        ),
    [libraryNodes],
  )
  const existingLibraryItemId =
    tab.saveTarget?.kind === 'library' ? tab.saveTarget.libraryItemId : tab.savedQueryId
  const existingNode = libraryNodes.find((node) => node.id === existingLibraryItemId)
  const defaultFolderId =
    tab.tabKind === 'test-suite' || tab.testSuite
      ? 'library-root-tests'
      : 'library-root-queries'
  const [folderId, setFolderId] = useState(
    existingNode?.parentId ??
      folders.find((folder) => folder.id === defaultFolderId)?.id ??
      folders[0]?.id ??
      defaultFolderId,
  )
  const [name, setName] = useState(existingNode?.name ?? displayLibraryNameForTab(tab.title))
  const itemLabel = tab.tabKind === 'test-suite' || tab.testSuite ? 'Test Suite' : 'Query'

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog save-query-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-query-dialog-title"
      >
        <p className="sidebar-eyebrow">Save {itemLabel}</p>
        <h2 id="save-query-dialog-title">Save {displayLibraryNameForTab(tab.title)}</h2>
        <p>
          Save this item to the workspace Library, or save a standalone local
          file.
        </p>

        <div className="save-query-fields">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Folder</span>
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {libraryNodePath(libraryNodes, folder)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="drawer-button" onClick={onSaveLocal}>
            Local File
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={!name.trim() || !folderId}
            onClick={() =>
              onSaveToLibrary({
                folderId,
                itemId: existingLibraryItemId,
                name: name.trim(),
              })
            }
          >
            Save
          </button>
        </div>
      </section>
    </div>
  )
}

function libraryNodePath(nodes: LibraryNode[], node: LibraryNode) {
  const names = [node.name]
  let parentId = node.parentId
  const visited = new Set<string>()

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.find((candidate) => candidate.id === parentId)
    if (!parent) {
      break
    }
    names.unshift(parent.name)
    parentId = parent.parentId
  }

  return names.join(' / ')
}

function displayLibraryNameForTab(title: string) {
  return title.replace(/\.(datapad-test\.json|sql|json|redis|promql|cql|txt)$/i, '')
}

export function DeleteConnectionDialog({
  connection,
  onCancel,
  onConfirm,
}: {
  connection: ConnectionProfile
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-connection-dialog-title"
      >
        <p className="sidebar-eyebrow">Delete Connection</p>
        <h2 id="delete-connection-dialog-title">Remove {connection.name}?</h2>
        <p>
          This removes the local connection profile from this workspace. Secrets
          referenced by the profile are not shown or exported by this action.
        </p>
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--danger"
            onClick={onConfirm}
          >
            Delete Connection
          </button>
        </div>
      </section>
    </div>
  )
}
