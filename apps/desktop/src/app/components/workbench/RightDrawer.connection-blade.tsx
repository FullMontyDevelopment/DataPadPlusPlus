import { useState } from 'react'
import type {
  ConnectionProfile,
  ConnectionTestResult,
  EnvironmentProfile,
  LocalDatabaseCreateRequest,
  LocalDatabaseCreateResult,
  LocalDatabaseManifest,
  LocalDatabasePickRequest,
  LocalDatabasePickResult,
} from '@datapadplusplus/shared-types'
import { ConnectionsIcon } from './icons'
import { ConnectionFooter } from './RightDrawer.connection-footer'
import { ConnectionForm } from './RightDrawer.connection-form'
import {
  engineOption,
  environmentAccentVariables,
  inferConnectionName,
  isCustomConnectionName,
  redactEnvironmentSecrets,
} from './RightDrawer.helpers'
import { DrawerHeader } from './RightDrawer.primitives'

interface ConnectionBladeProps {
  activeConnection: ConnectionProfile
  environments: EnvironmentProfile[]
  connectionTest?: ConnectionTestResult
  onClose(): void
  onSaveConnection(profile: ConnectionProfile, secret?: string): Promise<boolean>
  onTestConnection(profile: ConnectionProfile, environmentId: string, secret?: string): void
  onPickLocalDatabaseFile(request: LocalDatabasePickRequest): Promise<LocalDatabasePickResult>
  onCreateLocalDatabase(
    request: LocalDatabaseCreateRequest,
  ): Promise<LocalDatabaseCreateResult | undefined>
}

export function ConnectionBlade({
  activeConnection,
  environments,
  connectionTest,
  onClose,
  onSaveConnection,
  onTestConnection,
  onPickLocalDatabaseFile,
  onCreateLocalDatabase,
}: ConnectionBladeProps) {
  const [nameOverridden, setNameOverridden] = useState(() =>
    isCustomConnectionName(activeConnection),
  )
  const [connectionDraft, setConnectionDraft] = useState(() =>
    isCustomConnectionName(activeConnection)
      ? activeConnection
      : {
          ...activeConnection,
          name: inferConnectionName(activeConnection),
        },
  )
  const [secretDraft, setSecretDraft] = useState('')
  const [pendingCreateFolder, setPendingCreateFolder] = useState('')
  const [localDatabaseName, setLocalDatabaseName] = useState('')
  const [localDatabaseStatus, setLocalDatabaseStatus] = useState('')

  const selectedEngineOption = engineOption(connectionDraft.engine)
  const localDatabaseManifest = selectedEngineOption?.localDatabase
  const selectedEnvironmentId = connectionDraft.environmentIds[0] ?? ''
  const selectedEnvironment = environments.find(
    (environment) => environment.id === selectedEnvironmentId,
  )
  const environmentAccentStyle = environmentAccentVariables(selectedEnvironment)
  const displayedResolvedHost = connectionTest
    ? redactEnvironmentSecrets(connectionTest.resolvedHost, selectedEnvironmentId, environments)
    : ''
  const displayedResolvedDatabase = connectionTest?.resolvedDatabase
    ? redactEnvironmentSecrets(
        connectionTest.resolvedDatabase,
        selectedEnvironmentId,
        environments,
      )
    : undefined

  const updateConnectionDraft = (
    patch: Partial<ConnectionProfile>,
    options: { preserveName?: boolean } = {},
  ) => {
    if (patch.engine && patch.engine !== connectionDraft.engine) {
      setPendingCreateFolder('')
      setLocalDatabaseName('')
      setLocalDatabaseStatus('')
    }

    setConnectionDraft((current) => {
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      }

      return options.preserveName || nameOverridden
        ? next
        : {
            ...next,
            name: inferConnectionName(next),
          }
    })
  }

  const setLocalDatabasePath = (path: string) => {
    updateConnectionDraft({
      host: path,
      database: path,
      port: undefined,
    })
  }

  const connectionForAction = () =>
    normalizeConnectionForMode({
      ...connectionDraft,
      name: connectionDraft.name.trim() || inferConnectionName(connectionDraft),
      connectionMode:
        connectionDraft.connectionMode ?? selectedEngineOption?.connectionMode ?? 'native',
    })

  const openExistingLocalDatabase = async () => {
    const result = await onPickLocalDatabaseFile({
      engine: connectionDraft.engine,
      purpose: 'open',
      currentPath: connectionDraft.database,
    })

    if (result.canceled || !result.path) {
      return
    }

    setLocalDatabasePath(result.path)
    setLocalDatabaseStatus(`${selectedEngineOption?.label ?? 'Local'} database path selected.`)
  }

  const chooseNewLocalDatabasePath = async () => {
    const result = await onPickLocalDatabaseFile({
      engine: connectionDraft.engine,
      purpose: 'create',
      currentPath: connectionDraft.database,
    })

    if (result.canceled || !result.path) {
      return
    }

    setPendingCreateFolder(result.path)
    setLocalDatabaseName((current) =>
      current.trim()
        ? current
        : defaultLocalDatabaseName(localDatabaseManifest),
    )
    setLocalDatabaseStatus('')
  }

  const createLocalDatabase = async (mode: LocalDatabaseCreateRequest['mode']) => {
    if (!pendingCreateFolder || !localDatabaseName.trim()) {
      return
    }

    const databasePath = composeLocalDatabasePath(
      pendingCreateFolder,
      localDatabaseName,
      localDatabaseManifest,
    )
    const result = await onCreateLocalDatabase({
      engine: connectionDraft.engine,
      path: databasePath,
      mode,
      connectionId: connectionDraft.id,
      environmentId: selectedEnvironmentId || undefined,
    })

    if (!result) {
      return
    }

    const nextConnection = {
      ...connectionDraft,
      host: result.path,
      database: result.path,
    }
    const updatedConnection = {
      ...connectionDraft,
      host: result.path,
      database: result.path,
      name: nameOverridden ? connectionDraft.name : inferConnectionName(nextConnection),
      port: undefined,
      updatedAt: new Date().toISOString(),
    }

    setConnectionDraft(updatedConnection)
    setPendingCreateFolder('')
    setLocalDatabaseStatus(
      result.warnings.length > 0
        ? `${result.message} ${result.warnings.join(' ')}`
        : result.message,
    )
  }

  const closeConnectionDrawer = () => {
    setSecretDraft('')
    onClose()
  }

  const saveConnectionAndClearSecret = async (profile: ConnectionProfile, secret?: string) => {
    const saved = await onSaveConnection(profile, secret)

    if (saved) {
      setSecretDraft('')
    }

    return saved
  }

  const testConnectionWithDraftSecret = (
    profile: ConnectionProfile,
    environmentId: string,
    secret?: string,
  ) => {
    onTestConnection(profile, environmentId, secret)
  }

  return (
    <>
      <DrawerHeader
        title="Connection"
        subtitle="Profile"
        icon={ConnectionsIcon}
        onClose={closeConnectionDrawer}
      />

      <div className="drawer-scroll">
        <div
          className={`drawer-section connection-profile-section${selectedEnvironment ? ' has-environment-accent' : ''}`}
          style={environmentAccentStyle}
        >
          <div className="drawer-section-header">
            <strong>Connection</strong>
            <span>{connectionDraft.engine}</span>
          </div>

          <ConnectionForm
            connectionDraft={connectionDraft}
            environments={environments}
            localDatabaseManifest={localDatabaseManifest}
            localDatabaseName={localDatabaseName}
            localDatabaseStatus={localDatabaseStatus}
            namePlaceholder={inferConnectionName(connectionDraft)}
            pendingCreateFolder={pendingCreateFolder}
            secretDraft={secretDraft}
            selectedEnvironmentId={selectedEnvironmentId}
            createLocalDatabase={createLocalDatabase}
            onChooseNewLocalDatabasePath={chooseNewLocalDatabasePath}
            onLocalDatabaseNameChange={setLocalDatabaseName}
            onOpenExistingLocalDatabase={openExistingLocalDatabase}
            onSecretDraftChange={setSecretDraft}
            onSetNameOverridden={setNameOverridden}
            onUpdateConnectionDraft={updateConnectionDraft}
          />
        </div>
      </div>

      <ConnectionFooter
        connectionTest={connectionTest}
        environmentAccentStyle={environmentAccentStyle}
        getConnectionForAction={connectionForAction}
        hasEnvironment={Boolean(selectedEnvironment)}
        resolvedDatabase={displayedResolvedDatabase}
        resolvedHost={displayedResolvedHost}
        secretDraft={secretDraft}
        selectedEnvironmentId={selectedEnvironmentId}
        onSaveConnection={saveConnectionAndClearSecret}
        onTestConnection={testConnectionWithDraftSecret}
      />
    </>
  )
}

function defaultLocalDatabaseName(manifest?: LocalDatabaseManifest) {
  const extension = manifest?.defaultExtension ?? 'db'
  return `datapadplusplus.${extension}`
}

function composeLocalDatabasePath(
  folder: string,
  databaseName: string,
  manifest?: LocalDatabaseManifest,
) {
  const trimmedFolder = folder.trim()
  const fileName = databaseNameWithExtension(
    databaseName.trim(),
    manifest?.defaultExtension,
  )
  const separator = trimmedFolder.endsWith('\\') || trimmedFolder.endsWith('/')
    ? ''
    : trimmedFolder.includes('\\')
      ? '\\'
      : '/'

  return `${trimmedFolder}${separator}${fileName}`
}

function databaseNameWithExtension(databaseName: string, extension?: string) {
  const trimmed = databaseName.trim()
  const defaultExtension = extension?.replace(/^\./, '')

  if (!defaultExtension || /\.[^\\/]+$/.test(trimmed)) {
    return trimmed
  }

  return `${trimmed}.${defaultExtension}`
}

function normalizeConnectionForMode(profile: ConnectionProfile): ConnectionProfile {
  const mode = profile.connectionMode ?? 'native'

  if (mode === 'connection-string') {
    return {
      ...profile,
      host: '',
      port: undefined,
      connectionString: profile.connectionString ?? '',
    }
  }

  if (mode === 'local-file') {
    const path = profile.database || profile.host

    return {
      ...profile,
      host: path,
      port: undefined,
      database: path,
      connectionString: undefined,
    }
  }

  return {
    ...profile,
    connectionString: undefined,
  }
}
