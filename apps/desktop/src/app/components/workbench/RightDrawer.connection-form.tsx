import type {
  ConnectionMode,
  ConnectionProfile,
  EnvironmentProfile,
  LocalDatabaseCreateRequest,
  LocalDatabaseManifest,
} from '@datapadplusplus/shared-types'
import { FavoriteIcon, ReadOnlyIcon } from './icons'
import {
  defaultPortForEngine,
  engineFamily,
  engineLabel,
  engineOption,
} from './RightDrawer.helpers'
import {
  ConnectionModeFields,
  ConnectionModeTabs,
  type UpdateConnectionDraft,
} from './RightDrawer.connection-modes'
import { normalizeConnectionMode } from './RightDrawer.connection-mode-helpers'
import { DatastoreEngineSelect } from './RightDrawer.engine-select'
import { FormField } from './RightDrawer.primitives'

interface ConnectionFormProps {
  connectionDraft: ConnectionProfile
  environments: EnvironmentProfile[]
  localDatabaseManifest?: LocalDatabaseManifest
  localDatabaseName: string
  localDatabaseStatus: string
  namePlaceholder: string
  pendingCreateFolder: string
  secretDraft: string
  selectedEnvironmentId: string
  createLocalDatabase(mode: LocalDatabaseCreateRequest['mode']): Promise<void>
  onChooseNewLocalDatabasePath(): Promise<void>
  onLocalDatabaseNameChange(value: string): void
  onOpenExistingLocalDatabase(): Promise<void>
  onSecretDraftChange(value: string): void
  onSetNameOverridden(value: boolean): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}

export function ConnectionForm({
  connectionDraft,
  environments,
  localDatabaseManifest,
  localDatabaseName,
  localDatabaseStatus,
  namePlaceholder,
  pendingCreateFolder,
  secretDraft,
  selectedEnvironmentId,
  createLocalDatabase,
  onChooseNewLocalDatabasePath,
  onLocalDatabaseNameChange,
  onOpenExistingLocalDatabase,
  onSecretDraftChange,
  onSetNameOverridden,
  onUpdateConnectionDraft,
}: ConnectionFormProps) {
  const selectedEngineOption = engineOption(connectionDraft.engine)
  const connectionModes = selectedEngineOption?.connectionModes ?? ['native']
  const activeMode = normalizeConnectionMode(
    connectionModes,
    connectionDraft.connectionMode,
  )

  const updateEngine = (engine: ConnectionProfile['engine']) => {
    const nextEngineOption = engineOption(engine)
    const nextModes = nextEngineOption?.connectionModes ?? ['native']
    const nextMode = normalizeConnectionMode(nextModes, connectionDraft.connectionMode)

    onUpdateConnectionDraft({
      engine,
      family: engineFamily(engine),
      connectionMode: nextMode,
      ...connectionPatchForMode(nextMode, connectionDraft, engine, {
        preserveConnectionString: false,
        preserveLocalPath: false,
        preservePort: false,
      }),
    })
  }

  const updateConnectionMode = (mode: ConnectionMode) => {
    onUpdateConnectionDraft({
      connectionMode: mode,
      ...connectionPatchForMode(mode, connectionDraft, connectionDraft.engine),
    })
  }

  return (
    <div className="drawer-form">
      <div className="drawer-field">
        <span>Database type</span>
        <DatastoreEngineSelect value={connectionDraft.engine} onChange={updateEngine} />
      </div>

      <ConnectionModeTabs
        activeMode={activeMode}
        modes={connectionModes}
        onChange={updateConnectionMode}
      />

      <ConnectionModeFields
        activeMode={activeMode}
        connectionDraft={connectionDraft}
        databaseLabel={engineLabel(connectionDraft.engine)}
        localDatabaseManifest={localDatabaseManifest}
        localDatabaseName={localDatabaseName}
        localDatabaseStatus={localDatabaseStatus}
        pendingCreateFolder={pendingCreateFolder}
        secretDraft={secretDraft}
        createLocalDatabase={createLocalDatabase}
        onChooseNewLocalDatabasePath={onChooseNewLocalDatabasePath}
        onLocalDatabaseNameChange={onLocalDatabaseNameChange}
        onOpenExistingLocalDatabase={onOpenExistingLocalDatabase}
        onSecretDraftChange={onSecretDraftChange}
        onUpdateConnectionDraft={onUpdateConnectionDraft}
      />

      <FormField label="Name">
        <input
          value={connectionDraft.name}
          placeholder={namePlaceholder}
          onChange={(event) => {
            onSetNameOverridden(event.target.value.trim().length > 0)
            onUpdateConnectionDraft({ name: event.target.value }, { preserveName: true })
          }}
        />
      </FormField>

      <FormField label="Environment">
        <select
          value={selectedEnvironmentId}
          onChange={(event) =>
            onUpdateConnectionDraft({
              environmentIds: event.target.value ? [event.target.value] : [],
            })
          }
        >
          <option value="">None</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.label}
            </option>
          ))}
        </select>
      </FormField>

      <ConnectionFlags
        favorite={connectionDraft.favorite}
        readOnly={connectionDraft.readOnly}
        onUpdateConnectionDraft={onUpdateConnectionDraft}
      />
    </div>
  )
}

function connectionPatchForMode(
  mode: ConnectionMode,
  draft: ConnectionProfile,
  engine: ConnectionProfile['engine'],
  options: {
    preserveConnectionString?: boolean
    preserveLocalPath?: boolean
    preservePort?: boolean
  } = {},
): Partial<ConnectionProfile> {
  const preserveConnectionString = options.preserveConnectionString ?? true
  const preserveLocalPath = options.preserveLocalPath ?? true
  const preservePort = options.preservePort ?? true

  if (mode === 'connection-string') {
    return {
      host: '',
      port: undefined,
      connectionString: preserveConnectionString ? draft.connectionString ?? '' : '',
    }
  }

  if (mode === 'local-file') {
    const path = preserveLocalPath ? draft.database || draft.host : ''

    return {
      host: path,
      port: undefined,
      database: path,
      connectionString: undefined,
      auth: {
        ...draft.auth,
        connectionStringSecretRef: undefined,
        username: undefined,
        sslMode: undefined,
        cloudProvider: undefined,
        principal: undefined,
      },
    }
  }

  return {
    host: draft.host || 'localhost',
    port: preservePort ? draft.port ?? defaultPortForEngine(engine) : defaultPortForEngine(engine),
    connectionString: undefined,
    auth: {
      ...draft.auth,
      connectionStringSecretRef: undefined,
    },
  }
}

function ConnectionFlags({
  favorite,
  readOnly,
  onUpdateConnectionDraft,
}: {
  favorite: boolean
  readOnly: boolean
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  return (
    <div className="connection-flags-section">
      <div className="connection-flags-title">
        <span>Connection options</span>
      </div>
      <div className="drawer-toggle-row">
        <button
          type="button"
          className={`drawer-toggle${favorite ? ' is-active' : ''}`}
          onClick={() => onUpdateConnectionDraft({ favorite: !favorite })}
        >
          <FavoriteIcon className="drawer-inline-icon" />
          Favorite
        </button>
        <button
          type="button"
          className={`drawer-toggle${readOnly ? ' is-active' : ''}`}
          onClick={() => onUpdateConnectionDraft({ readOnly: !readOnly })}
        >
          <ReadOnlyIcon className="drawer-inline-icon" />
          Read-only
        </button>
      </div>
    </div>
  )
}
