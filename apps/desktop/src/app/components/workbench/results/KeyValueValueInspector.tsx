import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyValueValueReadResult } from '@datapadplusplus/shared-types'
import { DesktopCodeEditor } from '../DesktopCodeEditor'
import { CloseIcon, CopyIcon, JsonIcon, RenameIcon } from '../icons'
import { JsonTreeView } from './JsonTreeView'
import { copyText } from './payload-export'

interface KeyValueValueInspectorProps {
  canEdit: boolean
  content?: KeyValueValueReadResult
  entryLabel: string
  error?: string
  loading: boolean
  theme: string
  onBeginJsonPathEdit?(path: string, value: unknown): void
  onClose(): void
  onDeleteJsonPath?(path: string, value: unknown): void
  onEdit(): void
}

export function KeyValueValueInspector({
  canEdit,
  content,
  entryLabel,
  error,
  loading,
  theme,
  onBeginJsonPathEdit,
  onClose,
  onDeleteJsonPath,
  onEdit,
}: KeyValueValueInspectorProps) {
  const [view, setView] = useState<'source' | 'tree' | 'base64' | 'hex'>('source')
  const [copyStatus, setCopyStatus] = useState('')
  const copyStatusTimerRef = useRef<number | undefined>(undefined)
  const decoded = useMemo(() => decodeValueContent(content), [content])
  const supportsTree = decoded.jsonValue !== undefined
  const isBinary = content?.contentKind === 'binary'
  const source = isBinary
    ? view === 'hex'
      ? decoded.hex
      : content?.dataBase64 ?? ''
    : decoded.formattedText
  const contentLabel = isBinary ? 'Binary' : supportsTree ? 'JSON' : 'Text'

  const copy = async (label: string, value: string) => {
    await copyText(value)
    setCopyStatus(`${label} copied.`)
    window.clearTimeout(copyStatusTimerRef.current)
    copyStatusTimerRef.current = window.setTimeout(() => setCopyStatus(''), 1800)
  }

  useEffect(() => () => window.clearTimeout(copyStatusTimerRef.current), [])

  return (
    <aside className="document-field-inspector keyvalue-value-inspector" aria-label="Key-value inspector">
      <header className="document-field-inspector-header">
        <div className="keyvalue-value-inspector-title">
          <strong title={entryLabel}>{entryLabel}</strong>
          {content ? (
            <>
              <span className="keyvalue-value-inspector-badge">{contentLabel}</span>
              <span className="keyvalue-value-inspector-badge">{formatByteCount(content.byteLength)}</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="bottom-panel-icon-button"
          aria-label="Close value inspector"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon className="panel-inline-icon" />
        </button>
      </header>

      {loading ? (
        <div className="document-field-inspector-preparing" role="status">
          Loading the complete value…
        </div>
      ) : error ? (
        <div className="keyvalue-value-inspector-error" role="alert">{error}</div>
      ) : supportsTree && view === 'tree' ? (
        <div className="keyvalue-value-inspector-tree">
          <JsonTreeView
            value={decoded.jsonValue}
            label={entryLabel}
            onDeleteValue={onDeleteJsonPath}
            onEditValue={onBeginJsonPathEdit}
          />
        </div>
      ) : (
        <div className="document-field-inspector-editor" title="Use Ctrl+F to search within the full value.">
          <DesktopCodeEditor
            ariaLabel={`Complete value for ${entryLabel}`}
            language={supportsTree && !isBinary ? 'json' : 'plaintext'}
            readOnly
            resetKey={`${entryLabel}:${view}:${content?.byteLength ?? 0}`}
            theme={theme}
            value={source}
            onChange={() => undefined}
          />
        </div>
      )}

      <footer className="keyvalue-value-inspector-footer">
        <div className="keyvalue-value-inspector-view-switcher" role="group" aria-label="Value view">
          {supportsTree && !isBinary ? (
            <>
              <button
                type="button"
                className={view === 'source' ? 'is-active' : ''}
                aria-pressed={view === 'source'}
                onClick={() => setView('source')}
              >
                Source
              </button>
              <button
                type="button"
                className={view === 'tree' ? 'is-active' : ''}
                aria-pressed={view === 'tree'}
                onClick={() => setView('tree')}
              >
                Tree View
              </button>
            </>
          ) : null}
          {isBinary ? (
            <>
              <button
                type="button"
                className={view === 'base64' ? 'is-active' : ''}
                aria-pressed={view === 'base64'}
                onClick={() => setView('base64')}
              >
                Base64
              </button>
              <button
                type="button"
                className={view === 'hex' ? 'is-active' : ''}
                aria-pressed={view === 'hex'}
                onClick={() => setView('hex')}
              >
                Hex
              </button>
            </>
          ) : null}
        </div>
        <div className="keyvalue-value-inspector-toolbar">
          {copyStatus ? <span role="status">{copyStatus}</span> : null}
          <button
            type="button"
            className="keyvalue-value-inspector-icon-action"
            aria-label="Copy value"
            title={isBinary ? 'Copy complete value as Base64' : 'Copy complete value'}
            disabled={!content}
            onClick={() => void copy('Value', isBinary ? content?.dataBase64 ?? '' : decoded.text)}
          >
            <CopyIcon />
          </button>
          {supportsTree && !isBinary ? (
            <button
              type="button"
              className="keyvalue-value-inspector-action"
              aria-label="Copy formatted JSON"
              title="Copy formatted JSON"
              onClick={() => void copy('Formatted JSON', decoded.formattedText)}
            >
              <JsonIcon />
              <span>Copy JSON</span>
            </button>
          ) : null}
          {canEdit && content && !isBinary ? (
            <button
              type="button"
              className="keyvalue-value-inspector-action is-primary"
              onClick={onEdit}
            >
              <RenameIcon />
              <span>Edit</span>
            </button>
          ) : null}
        </div>
      </footer>
    </aside>
  )
}

function decodeValueContent(content?: KeyValueValueReadResult) {
  if (!content) {
    return { text: '', formattedText: '', hex: '', jsonValue: undefined as unknown }
  }
  const bytes = base64ToBytes(content.dataBase64)
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
    .map((value, index) => (index > 0 && index % 32 === 0 ? `\n${value}` : value))
    .join(' ')
  if (content.contentKind === 'binary') {
    return { text: '', formattedText: '', hex, jsonValue: undefined as unknown }
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  try {
    const jsonValue = JSON.parse(text) as unknown
    return { text, formattedText: JSON.stringify(jsonValue, null, 2), hex, jsonValue }
  } catch {
    return { text, formattedText: text, hex, jsonValue: undefined as unknown }
  }
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function formatByteCount(value?: number) {
  if (value === undefined) return 'Loading…'
  if (value < 1024) return `${value.toLocaleString()} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
