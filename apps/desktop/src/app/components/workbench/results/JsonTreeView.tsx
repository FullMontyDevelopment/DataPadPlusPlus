import { useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '../icons'

const DEFAULT_MAX_CHILDREN = 250
const MAX_PREVIEW_LENGTH = 160

type JsonTreeValue =
  | null
  | string
  | number
  | boolean
  | JsonTreeValue[]
  | { [key: string]: JsonTreeValue | unknown }
  | unknown

interface JsonTreeViewProps {
  value: JsonTreeValue
  label?: string
  maxChildren?: number
  defaultExpandAll?: boolean
  onCopyPath?(path: string): void | Promise<void>
  onCopyValue?(value: unknown): void | Promise<void>
  onDeleteValue?(path: string, value: unknown): void | Promise<void>
  onEditValue?(path: string, value: unknown): void | Promise<void>
}

interface JsonTreeNodeProps {
  value: JsonTreeValue
  label: string
  path: string
  depth: number
  expanded: Set<string>
  maxChildren: number
  onCopyPath?(path: string): void | Promise<void>
  onCopyValue?(value: unknown): void | Promise<void>
  onDeleteValue?(path: string, value: unknown): void | Promise<void>
  onEditValue?(path: string, value: unknown): void | Promise<void>
  onToggle(path: string): void
}

export function JsonTreeView({
  value,
  label = 'root',
  maxChildren = DEFAULT_MAX_CHILDREN,
  defaultExpandAll = false,
  onCopyPath,
  onCopyValue,
  onDeleteValue,
  onEditValue,
}: JsonTreeViewProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    defaultExpandAll ? expandablePathsForValue(value) : new Set(),
  )

  const toggleNode = (path: string) => {
    setExpandedNodes((current) => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  return (
    <div className="json-tree" role="tree" aria-label={`${label} JSON tree`}>
      <JsonTreeNode
        value={value}
        label={label}
        path="$"
        depth={0}
        expanded={expandedNodes}
        maxChildren={maxChildren}
        onCopyPath={onCopyPath}
        onCopyValue={onCopyValue}
        onDeleteValue={onDeleteValue}
        onEditValue={onEditValue}
        onToggle={toggleNode}
      />
    </div>
  )
}

function JsonTreeNode({
  value,
  label,
  path,
  depth,
  expanded,
  maxChildren,
  onCopyPath,
  onCopyValue,
  onDeleteValue,
  onEditValue,
  onToggle,
}: JsonTreeNodeProps) {
  const kind = valueKind(value)
  const children = useMemo(() => childrenForValue(value, path), [path, value])
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(path)
  const visibleChildren = children.slice(0, maxChildren)
  const hiddenChildren = children.length - visibleChildren.length

  return (
    <>
      <div
        className={`json-tree-row is-${kind}`}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        style={{ ['--json-tree-depth' as string]: depth }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="json-tree-toggle"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => onToggle(path)}
          >
            {isExpanded ? (
              <ChevronDownIcon className="panel-inline-icon" />
            ) : (
              <ChevronRightIcon className="panel-inline-icon" />
            )}
          </button>
        ) : (
          <span className="json-tree-spacer" aria-hidden="true" />
        )}
        <span className="json-tree-label">{label}</span>
        <span className="json-tree-type">{kind}</span>
        <span className="json-tree-preview">{previewValue(value, children.length)}</span>
        <span className="json-tree-actions">
          {onCopyPath ? (
            <button
              type="button"
              className="json-tree-action"
              aria-label={`Copy path ${label}`}
              onClick={() => void onCopyPath(path)}
            >
              Path
            </button>
          ) : null}
          {onCopyValue ? (
            <button
              type="button"
              className="json-tree-action"
              aria-label={`Copy value ${label}`}
              onClick={() => void onCopyValue(value)}
            >
              Value
            </button>
          ) : null}
          {onEditValue ? (
            <button
              type="button"
              className="json-tree-action"
              aria-label={`Edit path ${label}`}
              onClick={() => void onEditValue(path, value)}
            >
              Edit
            </button>
          ) : null}
          {onDeleteValue && path !== '$' ? (
            <button
              type="button"
              className="json-tree-action"
              aria-label={`Delete path ${label}`}
              onClick={() => void onDeleteValue(path, value)}
            >
              Delete
            </button>
          ) : null}
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <div role="group">
          {visibleChildren.map((child) => (
            <JsonTreeNode
              key={child.path}
              value={child.value}
              label={child.label}
              path={child.path}
              depth={depth + 1}
              expanded={expanded}
              maxChildren={maxChildren}
              onCopyPath={onCopyPath}
              onCopyValue={onCopyValue}
              onDeleteValue={onDeleteValue}
              onEditValue={onEditValue}
              onToggle={onToggle}
            />
          ))}
          {hiddenChildren > 0 ? (
            <div
              className="json-tree-row json-tree-row--overflow"
              style={{ ['--json-tree-depth' as string]: depth + 1 }}
            >
              <span className="json-tree-spacer" aria-hidden="true" />
              <span className="json-tree-label">{hiddenChildren} more item(s)</span>
              <span className="json-tree-type">hidden</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function childrenForValue(value: JsonTreeValue, parentPath: string) {
  if (bsonScalarPreview(value)) {
    return []
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      label: `[${index}]`,
      path: `${parentPath}[${index}]`,
      value: item,
    }))
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => ({
      label: key,
      path: jsonObjectChildPath(parentPath, key),
      value: item,
    }))
  }

  return []
}

function valueKind(value: JsonTreeValue) {
  const bsonPreview = bsonScalarPreview(value)

  if (bsonPreview) {
    return bsonPreview.kind
  }

  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (isRecord(value)) {
    return 'object'
  }

  return typeof value
}

function previewValue(value: JsonTreeValue, childCount: number) {
  const bsonPreview = bsonScalarPreview(value)

  if (bsonPreview) {
    return bsonPreview.preview
  }

  if (Array.isArray(value)) {
    return `${childCount} item(s)`
  }

  if (isRecord(value)) {
    return `${childCount} field(s)`
  }

  if (typeof value === 'string') {
    return truncate(JSON.stringify(value))
  }

  if (value === null) {
    return 'null'
  }

  return truncate(String(value))
}

function truncate(value: string) {
  if (value.length <= MAX_PREVIEW_LENGTH) {
    return value
  }

  return `${value.slice(0, MAX_PREVIEW_LENGTH - 1)}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function jsonObjectChildPath(parentPath: string, key: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parentPath}.${key}`
  }

  return `${parentPath}[${JSON.stringify(key)}]`
}

function bsonScalarPreview(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.$oid === 'string') {
    return { kind: 'objectid', preview: `ObjectId("${value.$oid}")` }
  }

  if (typeof value.$uuid === 'string') {
    return { kind: 'uuid', preview: `UUID("${value.$uuid}")` }
  }

  if (typeof value.$date === 'string') {
    return { kind: 'date', preview: value.$date }
  }

  if (isRecord(value.$date) && typeof value.$date.$numberLong === 'string') {
    return { kind: 'date', preview: value.$date.$numberLong }
  }

  if (isRecord(value.$binary)) {
    return { kind: 'binary', preview: '<binary>' }
  }

  return undefined
}

function expandablePathsForValue(value: JsonTreeValue) {
  const paths = new Set<string>()
  collectExpandablePaths(value, '$', paths)
  return paths
}

function collectExpandablePaths(value: JsonTreeValue, path: string, paths: Set<string>) {
  const children = childrenForValue(value, path)

  if (children.length === 0) {
    return
  }

  paths.add(path)
  for (const child of children) {
    collectExpandablePaths(child.value, child.path, paths)
  }
}
