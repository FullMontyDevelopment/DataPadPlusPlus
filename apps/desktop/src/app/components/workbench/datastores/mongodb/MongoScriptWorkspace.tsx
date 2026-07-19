import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { DatastoreCompletionProvider, EditorCompletionContext } from '../../intellisense/types'
import { DesktopCodeEditor, type EditorInsertionRequest } from '../../DesktopCodeEditor'
import {
  MONGO_SCRIPT_CATALOG,
  MONGO_SCRIPT_SECTIONS,
  type MongoScriptCatalogEntry,
} from './mongo-script-catalog'
import { SearchIcon } from '../../icons'
import { MONGO_SCRIPT_DECLARATIONS, mongoScriptDiagnostics } from './mongo-script-language'

const GUIDE_MIN_WIDTH = 280
const GUIDE_MAX_WIDTH = 520

export function MongoScriptWorkspace({
  value,
  theme,
  resetKey,
  database,
  collection,
  guideVisible,
  guideWidth,
  completionContext,
  completionProviders,
  onRequestCompletionRefresh,
  onSelectionChange,
  onChange,
  onGuideWidthChange,
}: {
  value: string
  theme: string
  resetKey?: string | number
  database?: string
  collection?: string
  guideVisible: boolean
  guideWidth: number
  completionContext?: EditorCompletionContext
  completionProviders?: DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
  onSelectionChange?(selectedText: string): void
  onChange(value: string): void
  onGuideWidthChange(width: number): void
}) {
  const [search, setSearch] = useState('')
  const [insertion, setInsertion] = useState<EditorInsertionRequest>()
  const insertionSequence = useRef(0)
  const resizeRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined)
  const normalizedSearch = search.trim().toLowerCase()
  const entries = useMemo(
    () => MONGO_SCRIPT_CATALOG.filter((entry) => !normalizedSearch || [entry.section, entry.name, entry.signature, entry.summary, entry.risk].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [normalizedSearch],
  )

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = { startX: event.clientX, startWidth: guideWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeRef.current
    if (!origin) return
    onGuideWidthChange(clamp(origin.startWidth + origin.startX - event.clientX))
  }
  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const insertExample = (entry: MongoScriptCatalogEntry) => {
    insertionSequence.current += 1
    setInsertion({
      id: `${insertionSequence.current}-${entry.section}-${entry.name}`,
      text: entry.example(database ?? 'database', collection ?? 'collection'),
    })
  }

  return (
    <div
      className={`mongo-script-workspace${guideVisible ? ' has-guide' : ''}`}
      style={guideVisible ? { '--mongo-script-guide-width': `${clamp(guideWidth)}px` } as CSSProperties : undefined}
    >
      <div className="mongo-script-editor">
        <DesktopCodeEditor
          value={value}
          language="javascript"
          theme={theme}
          resetKey={resetKey}
          insertionRequest={insertion}
          ambientDeclarations={MONGO_SCRIPT_DECLARATIONS}
          buildDiagnostics={mongoScriptDiagnostics}
          ariaLabel="MongoDB script editor"
          completionContext={completionContext}
          completionProviders={completionProviders}
          onRequestCompletionRefresh={onRequestCompletionRefresh}
          onSelectionChange={onSelectionChange}
          onChange={onChange}
        />
      </div>

      {guideVisible ? (
        <aside className="mongo-script-guide" aria-label="MongoDB scripting guide">
          <div
            className="mongo-script-guide-resizer"
            role="separator"
            aria-label="Resize MongoDB scripting guide"
            aria-orientation="vertical"
            aria-valuemin={GUIDE_MIN_WIDTH}
            aria-valuemax={GUIDE_MAX_WIDTH}
            aria-valuenow={clamp(guideWidth)}
            tabIndex={0}
            onPointerDown={beginResize}
            onPointerMove={resize}
            onPointerUp={endResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                onGuideWidthChange(clamp(guideWidth + (event.key === 'ArrowLeft' ? 16 : -16)))
              }
            }}
          />
          <header className="mongo-script-guide-header">
            <div>
              <span className="mongo-script-guide-eyebrow">MongoDB</span>
              <strong>Scripting guide</strong>
            </div>
            <label className="mongo-script-guide-search">
              <SearchIcon className="toolbar-icon" />
              <input
                type="search"
                value={search}
                placeholder="Search methods and examples"
                aria-label="Search MongoDB scripting guide"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </header>
          <div className="mongo-script-guide-content">
            {MONGO_SCRIPT_SECTIONS.map((section) => {
              const sectionEntries = entries.filter((entry) => entry.section === section)
              if (sectionEntries.length === 0) return null
              return (
                <section className="mongo-script-guide-section" key={section}>
                  <h3>{section}</h3>
                  {sectionEntries.map((entry) => (
                    <article className="mongo-script-guide-entry" key={`${entry.section}-${entry.name}`}>
                      <div className="mongo-script-guide-entry-heading">
                        <code>{entry.signature}</code>
                        <span className={`mongo-script-risk mongo-script-risk--${entry.risk}`}>{entry.risk}</span>
                      </div>
                      <p>{entry.summary}</p>
                      <button type="button" onClick={() => insertExample(entry)}>Insert example</button>
                    </article>
                  ))}
                </section>
              )
            })}
            {entries.length === 0 ? <p className="mongo-script-guide-empty">No matching scripting entries.</p> : null}
          </div>
          <footer className="mongo-script-guide-links">
            <a href="https://www.mongodb.com/docs/mongodb-shell/write-scripts/" target="_blank" rel="noreferrer">Scripting</a>
            <a href="https://www.mongodb.com/docs/mongodb-shell/reference/methods/" target="_blank" rel="noreferrer">Methods</a>
            <a href="https://www.mongodb.com/docs/drivers/rust/current/crud/transactions/" target="_blank" rel="noreferrer">Transactions</a>
          </footer>
        </aside>
      ) : null}
    </div>
  )
}

function clamp(value: number) {
  return Math.min(GUIDE_MAX_WIDTH, Math.max(GUIDE_MIN_WIDTH, Math.round(value)))
}
