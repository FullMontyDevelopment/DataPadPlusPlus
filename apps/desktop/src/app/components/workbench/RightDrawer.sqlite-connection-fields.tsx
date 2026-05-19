import type { ConnectionProfile, SqliteConnectionOptions } from '@datapadplusplus/shared-types'
import { FormField } from './RightDrawer.primitives'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'

export function SqliteAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.sqliteOptions ?? {}
  const updateOptions = (patch: Partial<SqliteConnectionOptions>) =>
    onUpdateConnectionDraft({
      sqliteOptions: {
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="SQLite connection options">
      <strong>SQLite options</strong>

      <FormField label="Open mode">
        <select
          aria-label="SQLite open mode"
          value={options.openMode ?? 'read-write'}
          onChange={(event) =>
            updateOptions({
              openMode: event.target.value as SqliteConnectionOptions['openMode'],
              createIfMissing: event.target.value === 'read-write-create'
                ? true
                : options.createIfMissing,
            })
          }
        >
          <option value="read-write">Read/write existing file</option>
          <option value="read-only">Read-only existing file</option>
          <option value="read-write-create">Read/write, create if missing</option>
          <option value="memory">In-memory</option>
          <option value="shared-memory">Shared in-memory</option>
          <option value="uri">URI filename</option>
        </select>
      </FormField>

      <div className="drawer-toggle-grid">
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.createIfMissing ?? false}
            onChange={(event) => updateOptions({ createIfMissing: event.target.checked })}
          />
          <span>Create if missing</span>
        </label>
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.useUriFilename ?? false}
            onChange={(event) => updateOptions({ useUriFilename: event.target.checked })}
          />
          <span>URI filename</span>
        </label>
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.sharedCache ?? false}
            onChange={(event) => updateOptions({ sharedCache: event.target.checked })}
          />
          <span>Shared cache</span>
        </label>
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.immutable ?? false}
            onChange={(event) => updateOptions({ immutable: event.target.checked })}
          />
          <span>Immutable file</span>
        </label>
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.foreignKeys ?? true}
            onChange={(event) => updateOptions({ foreignKeys: event.target.checked })}
          />
          <span>Foreign keys</span>
        </label>
        <label className="drawer-checkbox">
          <input
            type="checkbox"
            checked={options.recursiveTriggers ?? false}
            onChange={(event) => updateOptions({ recursiveTriggers: event.target.checked })}
          />
          <span>Recursive triggers</span>
        </label>
      </div>

      <div className="connection-options-grid">
        <FormField label="Busy timeout (ms)">
          <input
            type="number"
            min={0}
            value={options.busyTimeoutMs ?? ''}
            placeholder="5000"
            onChange={(event) =>
              updateOptions({ busyTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Journal">
          <select
            aria-label="SQLite journal mode"
            value={options.journalMode ?? ''}
            onChange={(event) =>
              updateOptions({
                journalMode: (event.target.value || undefined) as SqliteConnectionOptions['journalMode'],
              })
            }
          >
            <option value="">Use file default</option>
            <option value="delete">DELETE</option>
            <option value="truncate">TRUNCATE</option>
            <option value="persist">PERSIST</option>
            <option value="memory">MEMORY</option>
            <option value="wal">WAL</option>
            <option value="off">OFF</option>
          </select>
        </FormField>
        <FormField label="Synchronous">
          <select
            aria-label="SQLite synchronous mode"
            value={options.synchronousMode ?? ''}
            onChange={(event) =>
              updateOptions({
                synchronousMode: (event.target.value || undefined) as SqliteConnectionOptions['synchronousMode'],
              })
            }
          >
            <option value="">Use file default</option>
            <option value="off">OFF</option>
            <option value="normal">NORMAL</option>
            <option value="full">FULL</option>
            <option value="extra">EXTRA</option>
          </select>
        </FormField>
        <FormField label="Cache size">
          <input
            type="number"
            value={options.cacheSize ?? ''}
            placeholder="-2000"
            onChange={(event) =>
              updateOptions({ cacheSize: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="drawer-callout">
        <strong>Encryption</strong>
        <span>
          Standard SQLite has no built-in users or password authentication. Encrypted files require
          a SQLCipher/provider-specific build, so DataPad++ will show a clear warning before trying
          to open one.
        </span>
      </div>
    </div>
  )
}
