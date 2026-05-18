import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import type { DocumentGridRow, DocumentValueType } from './document-grid-model'
import { copyText } from './payload-export'

const TYPE_OPTIONS: DocumentValueType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

interface DocumentFieldInspectorProps {
  canChangeType: boolean
  document: Record<string, unknown>
  row: DocumentGridRow
  onChangeType(row: DocumentGridRow, nextType: DocumentValueType): void
  onClose(): void
}

export function DocumentFieldInspector({
  canChangeType,
  document,
  row,
  onChangeType,
  onClose,
}: DocumentFieldInspectorProps) {
  const [searchText, setSearchText] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const rawJson = useMemo(() => formatRawJson(row.value, true), [row.value])
  const compactJson = useMemo(() => formatRawJson(row.value, false), [row.value])
  const documentJson = useMemo(() => formatRawJson(document, true), [document])
  const matches = useMemo(() => findMatches(rawJson, searchText), [rawJson, searchText])
  const activeMatchRef = useRef<HTMLElement | null>(null)
  const fieldPath = row.fieldPath || '$'
  const safeActiveMatchIndex =
    matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1)

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [safeActiveMatchIndex])

  const copy = async (label: string, text: string) => {
    await copyText(text)
    setCopyStatus(`${label} copied.`)
  }

  const matchLabel = searchText.trim()
    ? `${matches.length === 0 ? 0 : safeActiveMatchIndex + 1}/${matches.length}`
    : ''

  return (
    <aside className="document-field-inspector" aria-label="Document field raw JSON inspector">
      <header className="document-field-inspector-header">
        <div>
          <strong>Raw JSON</strong>
          <span>{fieldPath}</span>
        </div>
        <button type="button" className="bottom-panel-icon-button" aria-label="Close inspector" onClick={onClose}>
          x
        </button>
      </header>

      <dl className="document-field-inspector-meta">
        <div>
          <dt>Document</dt>
          <dd>{documentIdentity(document, row.documentIndex)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>
            {canChangeType ? (
              <select
                aria-label={`Change inspected field type ${fieldPath}`}
                value={row.type}
                onChange={(event) => onChangeType(row, event.target.value as DocumentValueType)}
              >
                {TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`document-type-badge is-${row.type}`}>{row.type}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="document-field-inspector-search">
        <input
          aria-label="Search raw JSON"
          placeholder="Search raw JSON"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value)
            setActiveMatchIndex(0)
          }}
        />
        <span>{matchLabel}</span>
        <button
          type="button"
          className="drawer-button"
          disabled={matches.length === 0}
          onClick={() => setActiveMatchIndex(wrapMatchIndex(safeActiveMatchIndex - 1, matches.length))}
        >
          Prev
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={matches.length === 0}
          onClick={() => setActiveMatchIndex(wrapMatchIndex(safeActiveMatchIndex + 1, matches.length))}
        >
          Next
        </button>
      </div>

      <pre className="document-field-inspector-code" aria-label="Selected field raw JSON">
        {renderHighlightedJson(rawJson, matches, safeActiveMatchIndex, activeMatchRef)}
      </pre>

      <div className="document-field-inspector-actions">
        <button type="button" className="drawer-button" onClick={() => void copy('Path', fieldPath)}>
          Copy Path
        </button>
        <button type="button" className="drawer-button" onClick={() => void copy('Raw JSON', rawJson)}>
          Copy Raw JSON
        </button>
        <button type="button" className="drawer-button" onClick={() => void copy('Compact JSON', compactJson)}>
          Copy Compact
        </button>
        <button type="button" className="drawer-button" onClick={() => void copy('Document JSON', documentJson)}>
          Copy Document JSON
        </button>
        {copyStatus ? <span>{copyStatus}</span> : null}
      </div>
    </aside>
  )
}

function formatRawJson(value: unknown, pretty: boolean) {
  if (value === undefined) {
    return 'undefined'
  }

  try {
    const formatted = JSON.stringify(value, null, pretty ? 2 : 0)
    return formatted ?? String(value)
  } catch {
    return String(value)
  }
}

function documentIdentity(document: Record<string, unknown>, index: number) {
  const value = document._id ?? document.id ?? document.key

  if (value === undefined) {
    return `document ${index + 1}`
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  return formatRawJson(value, false)
}

function findMatches(text: string, query: string) {
  const needle = query.trim()

  if (!needle) {
    return []
  }

  const matches: Array<{ end: number; start: number }> = []
  const lowerText = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  let index = lowerText.indexOf(lowerNeedle)

  while (index >= 0) {
    matches.push({ start: index, end: index + needle.length })
    index = lowerText.indexOf(lowerNeedle, index + needle.length)
  }

  return matches
}

function renderHighlightedJson(
  text: string,
  matches: Array<{ end: number; start: number }>,
  activeMatchIndex: number,
  activeMatchRef: MutableRefObject<HTMLElement | null>,
) {
  if (matches.length === 0) {
    return text
  }

  const parts: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start))
    }

    parts.push(
      <mark
        key={`${match.start}-${match.end}`}
        ref={(element) => {
          if (index === activeMatchIndex) {
            activeMatchRef.current = element
          }
        }}
        className={index === activeMatchIndex ? 'is-active' : undefined}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  })

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts
}

function wrapMatchIndex(nextIndex: number, total: number) {
  if (total <= 0) {
    return 0
  }

  if (nextIndex < 0) {
    return total - 1
  }

  if (nextIndex >= total) {
    return 0
  }

  return nextIndex
}
