import { useMemo, useState } from 'react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { ObjectDocumentIcon } from './icons'
import { relationalSourceText } from './RelationalSourcePreview.helpers'

type JsonRecord = Record<string, unknown>

export function RelationalSourcePreview({
  connection,
  kind,
  payload,
  sectionKey,
}: {
  connection: ConnectionProfile
  kind: string
  payload: JsonRecord
  sectionKey?: string
}) {
  const sourceText = useMemo(() => relationalSourceText(kind, payload), [kind, payload])
  const [visible, setVisible] = useState(false)

  if (!sourceText) {
    return null
  }

  const outline = sourceOutline(sourceText)

  return (
    <section
      className="object-view-section"
      data-relational-section-key={sectionKey}
      tabIndex={sectionKey ? -1 : undefined}
    >
      <div className="object-view-section-heading">
        <ObjectDocumentIcon className="panel-inline-icon" />
        <strong>Source Outline</strong>
        <span>{sourceLanguageLabel(connection)}</span>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Statement</span>
          <strong>{statementLabel(sourceText)}</strong>
        </div>
        <div className="object-view-card">
          <span>Lines</span>
          <strong>{String(lineCount(sourceText))}</strong>
        </div>
        <div className="object-view-card">
          <span>Length</span>
          <strong>{`${sourceText.length.toLocaleString()} chars`}</strong>
        </div>
      </div>
      {outline.length ? (
        <div className="object-view-action-chips" aria-label="SQL source outline">
          {outline.map((item) => (
            <span className="object-view-action-chip" key={item}>
              <ObjectDocumentIcon className="panel-inline-icon" />
              <span>{item}</span>
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="drawer-button"
        onClick={() => setVisible((current) => !current)}
      >
        <ObjectDocumentIcon className="panel-inline-icon" />
        {visible ? 'Hide source' : 'Show source'}
      </button>
      {visible ? <pre className="object-view-code">{sourceText}</pre> : null}
    </section>
  )
}

function sourceOutline(source: string) {
  const seen = new Set<string>()
  return source
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/^(create|alter|returns?|begin|declare|select|insert|update|delete|merge|execute|with|language)\b/i)?.[1])
    .filter((keyword): keyword is string => Boolean(keyword))
    .map((keyword) => `${keyword.toUpperCase()} block`)
    .filter((label) => {
      if (seen.has(label)) {
        return false
      }
      seen.add(label)
      return true
    })
    .slice(0, 6)
}

function statementLabel(source: string) {
  const keyword = source.match(/\b(create|alter|select|insert|update|delete|merge|exec|execute|with)\b/i)?.[1]
  return keyword ? `${keyword.toUpperCase()} statement` : 'SQL source'
}

function sourceLanguageLabel(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') {
    return 'T-SQL'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return connection.engine === 'mariadb' ? 'MariaDB SQL' : 'MySQL SQL'
  }

  if (connection.engine === 'sqlite') {
    return 'SQLite SQL'
  }

  if (connection.engine === 'duckdb') {
    return 'DuckDB SQL'
  }

  return 'PostgreSQL SQL'
}

function lineCount(source: string) {
  return source.split(/\r?\n/).length
}
