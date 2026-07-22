import { useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
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
  const closeTarget =
    tab.tabKind === 'environment'
      ? {
          eyebrow: 'Unsaved Environment',
          description:
            'has environment edits that have not been saved. Save keeps the workspace environment updated; discard closes the tab without applying the draft.',
        }
      : {
          eyebrow: 'Unsaved Library Item',
          description:
            'has edits that are not saved to its Library item or local file. Ephemeral tabs close immediately, but saved items need an explicit choice.',
        }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-tab-dialog-title"
      >
        <p className="sidebar-eyebrow">{closeTarget.eyebrow}</p>
        <h2 id="close-tab-dialog-title">Save changes before closing?</h2>
        <p>
          {tab.title} {closeTarget.description}
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
    folderId?: string
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
      '',
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
              <option value="">Library root</option>
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
            disabled={!name.trim()}
            onClick={() =>
              onSaveToLibrary({
                folderId: folderId || undefined,
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

interface DeleteConfirmationDialogProps {
  eyebrow: string
  title: string
  body: string
  confirmLabel: string
  onCancel(): void
  onConfirm(): void
}

function DeleteConfirmationDialog({
  eyebrow,
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: DeleteConfirmationDialogProps) {
  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirmation-dialog-title"
      >
        <p className="sidebar-eyebrow">{eyebrow}</p>
        <h2 id="delete-confirmation-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
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
    <DeleteConfirmationDialog
      eyebrow="Delete Connection"
      title={`Remove ${connection.name}?`}
      body="This removes the local connection profile from this workspace. Secrets referenced by the profile are not shown or exported by this action."
      confirmLabel="Delete Connection"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

export function DeleteLibraryNodeDialog({
  descendantCount = 0,
  node,
  onCancel,
  onConfirm,
}: {
  descendantCount?: number
  node: LibraryNode
  onCancel(): void
  onConfirm(): void
}) {
  const label = libraryNodeKindLabel(node)
  const title =
    node.kind === 'folder'
      ? `Delete folder ${node.name}?`
      : `Delete ${node.name}?`
  const body =
    node.kind === 'folder'
      ? descendantCount > 0
        ? `This deletes the folder and ${descendantCount} item${descendantCount === 1 ? '' : 's'} inside it. Open tabs linked to deleted Library items become unsaved.`
        : 'This deletes the empty folder from the workspace Library.'
      : `This removes the ${label.toLowerCase()} from the workspace Library. Open tabs linked to it become unsaved.`

  return (
    <DeleteConfirmationDialog
      eyebrow={`Delete ${label}`}
      title={title}
      body={body}
      confirmLabel={`Delete ${label}`}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

export function DeleteEnvironmentDialog({
  environment,
  onCancel,
  onConfirm,
}: {
  environment: EnvironmentProfile
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <DeleteConfirmationDialog
      eyebrow="Delete Environment"
      title={`Delete environment ${environment.label}?`}
      body="Connections, tabs, API servers, MCP access, and saved work using this environment will continue with No environment."
      confirmLabel="Delete Environment"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

function libraryNodeKindLabel(node: LibraryNode) {
  switch (node.kind) {
    case 'bookmark':
      return 'Bookmark'
    case 'connection':
      return 'Connection'
    case 'folder':
      return 'Folder'
    case 'note':
      return 'Note'
    case 'query':
      return 'Query'
    case 'script':
      return 'Script'
    case 'snapshot':
      return 'Snapshot'
    case 'snippet':
      return 'Snippet'
    case 'template':
      return 'Template'
    case 'test-suite':
      return 'Test Suite'
    default:
      return 'Library Item'
  }
}
