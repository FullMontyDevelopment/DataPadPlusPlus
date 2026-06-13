import type { ConnectionMode, ConnectionProfile, CosmosDbConnectionOptions } from '@datapadplusplus/shared-types'
import {
  COSMOS_FIXTURE_DATABASE,
  COSMOS_FIXTURE_EMULATOR_ENDPOINT,
  COSMOS_MICROSOFT_EMULATOR_ENDPOINT,
  endpointValueForCosmosMode,
  portFromCosmosEndpoint,
} from './RightDrawer.cosmosdb-connection-config'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function CosmosDbConnectionFields({
  connectionDraft,
  mode,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  mode: Extract<ConnectionMode, 'cloud-iam' | 'cloud-sdk'>
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.cosmosDbOptions ?? {}
  const connectMode = options.connectMode ?? (mode === 'cloud-sdk' ? 'emulator' : 'entra-id')
  const authMode = options.authMode ?? authModeForConnectMode(connectMode)
  const endpointValue = endpointValueForCosmosMode(connectMode, options.accountEndpoint ?? connectionDraft.host)
  const showSecret = authMode === 'account-key' || authMode === 'resource-token' || authMode === 'emulator'
  const updateOptions = (patch: Partial<CosmosDbConnectionOptions>) =>
    onUpdateConnectionDraft({
      cosmosDbOptions: {
        connectMode,
        authMode,
        ...options,
        ...patch,
      },
    })
  const applyEndpointPreset = (endpoint: string, database: string | undefined) => {
    updateOptions({
      connectMode: 'emulator',
      api: 'nosql',
      accountEndpoint: endpoint,
      authMode: 'emulator',
      databaseName: database || undefined,
      allowSelfSignedEmulatorCertificate: true,
    })
    onUpdateConnectionDraft(
      {
        host: endpoint,
        port: portFromCosmosEndpoint(endpoint),
        database: database || undefined,
      },
      { preserveName: true },
    )
  }

  return (
    <div className="connection-advanced-section" aria-label="Cosmos DB connection options">
      <strong>Cosmos DB options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="Cosmos DB connection mode"
            value={connectMode}
            onChange={(event) => {
              const nextMode = event.target.value as CosmosDbConnectionOptions['connectMode']
              const nextPatch: Partial<CosmosDbConnectionOptions> = {
                connectMode: nextMode,
                authMode: authModeForConnectMode(nextMode),
              }
              const connectionPatch: Partial<ConnectionProfile> = {}

              if (nextMode === 'emulator') {
                nextPatch.api = 'nosql'
                nextPatch.accountEndpoint = endpointValueForCosmosMode(nextMode, endpointValue)
                nextPatch.allowSelfSignedEmulatorCertificate = true
                connectionPatch.host = nextPatch.accountEndpoint
                connectionPatch.port = portFromCosmosEndpoint(nextPatch.accountEndpoint)
              }

              updateOptions(nextPatch)
              if (Object.keys(connectionPatch).length > 0) {
                onUpdateConnectionDraft(connectionPatch, { preserveName: true })
              }
            }}
          >
            <option value="emulator">Emulator</option>
            <option value="account-endpoint">Account endpoint</option>
            <option value="entra-id">Entra ID</option>
            <option value="managed-identity">Managed identity</option>
            <option value="resource-token">Resource token</option>
            <option value="connection-string">Connection string</option>
          </select>
        </FormField>
        <FormField label="API">
          <select
            aria-label="Cosmos DB API"
            value={options.api ?? 'nosql'}
            onChange={(event) =>
              updateOptions({ api: event.target.value as CosmosDbConnectionOptions['api'] })
            }
          >
            <option value="nosql">NoSQL</option>
            <option value="mongodb">MongoDB</option>
            <option value="cassandra">Cassandra</option>
            <option value="gremlin">Gremlin</option>
            <option value="table">Table</option>
          </select>
        </FormField>
      </div>

      <div className="connection-quick-actions" aria-label="Cosmos DB emulator presets">
        <div className="drawer-button-row drawer-button-row--compact">
          <button
            type="button"
            className="drawer-button"
            onClick={() =>
              applyEndpointPreset(
                COSMOS_MICROSOFT_EMULATOR_ENDPOINT,
                options.databaseName ?? connectionDraft.database,
              )
            }
          >
            Microsoft emulator
          </button>
          <button
            type="button"
            className="drawer-button"
            onClick={() => applyEndpointPreset(COSMOS_FIXTURE_EMULATOR_ENDPOINT, COSMOS_FIXTURE_DATABASE)}
          >
            DataPad++ fixture
          </button>
        </div>
      </div>

      <FormField label="Endpoint">
        <input
          aria-label="Cosmos DB account endpoint"
          value={endpointValue}
          placeholder={connectMode === 'emulator' ? COSMOS_MICROSOFT_EMULATOR_ENDPOINT : 'https://account.documents.azure.com'}
          onChange={(event) => {
            const endpoint = event.target.value || undefined
            updateOptions({ accountEndpoint: endpoint })
            onUpdateConnectionDraft(
              {
                host: endpoint || '',
                port: endpoint ? portFromCosmosEndpoint(endpoint) : connectionDraft.port,
              },
              { preserveName: true },
            )
          }}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Database">
          <input
            aria-label="Cosmos DB database name"
            value={options.databaseName ?? connectionDraft.database ?? ''}
            placeholder="catalog"
            onChange={(event) => {
              updateOptions({ databaseName: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
        <FormField label="Account">
          <input
            aria-label="Cosmos DB account name"
            value={options.accountName ?? ''}
            placeholder="datapad-cosmos"
            onChange={(event) => updateOptions({ accountName: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Auth">
          <select
            aria-label="Cosmos DB auth mode"
            value={authMode}
            onChange={(event) =>
              updateOptions({ authMode: event.target.value as CosmosDbConnectionOptions['authMode'] })
            }
          >
            <option value="emulator">Emulator key</option>
            <option value="account-key">Account key</option>
            <option value="resource-token">Resource token</option>
            <option value="entra-id">Entra ID</option>
            <option value="managed-identity">Managed identity</option>
            <option value="connection-string">Connection string</option>
          </select>
        </FormField>
        <FormField label="Secret">
          <input
            aria-label="Cosmos DB credential"
            type="password"
            autoComplete="new-password"
            disabled={!showSecret}
            value={showSecret ? secretDraft : ''}
            placeholder={connectionDraft.auth.secretRef ? 'Stored credential' : showSecret ? 'Account key or token' : 'Uses identity'}
            onChange={(event) => onSecretDraftChange(event.target.value)}
          />
        </FormField>
      </div>

      {authMode === 'entra-id' || authMode === 'managed-identity' ? (
        <div className="connection-advanced-grid">
          <FormField label="Tenant">
            <input
              aria-label="Cosmos DB tenant id"
              value={options.tenantId ?? ''}
              onChange={(event) => updateOptions({ tenantId: event.target.value || undefined })}
            />
          </FormField>
          <FormField label="Client">
            <input
              aria-label="Cosmos DB client id"
              value={options.clientId ?? options.managedIdentityClientId ?? ''}
              onChange={(event) =>
                updateOptions({
                  clientId: authMode === 'entra-id' ? event.target.value || undefined : options.clientId,
                  managedIdentityClientId:
                    authMode === 'managed-identity' ? event.target.value || undefined : options.managedIdentityClientId,
                })
              }
            />
          </FormField>
        </div>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Consistency">
          <select
            aria-label="Cosmos DB consistency level"
            value={options.consistencyLevel ?? 'session'}
            onChange={(event) =>
              updateOptions({
                consistencyLevel:
                  event.target.value as CosmosDbConnectionOptions['consistencyLevel'],
              })
            }
          >
            <option value="strong">Strong</option>
            <option value="bounded-staleness">Bounded staleness</option>
            <option value="session">Session</option>
            <option value="consistent-prefix">Consistent prefix</option>
            <option value="eventual">Eventual</option>
          </select>
        </FormField>
        <FormField label="Items">
          <input
            aria-label="Cosmos DB max item count"
            type="number"
            min={1}
            max={10000}
            value={options.maxItemCount ?? ''}
            onChange={(event) =>
              updateOptions({ maxItemCount: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <FormField label="Regions">
        <input
          aria-label="Cosmos DB preferred regions"
          value={(options.preferredRegions ?? []).join(', ')}
          placeholder="North Europe, West Europe"
          onChange={(event) =>
            updateOptions({
              preferredRegions: event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
        />
      </FormField>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.enableCrossPartitionQueries ?? true}
            onChange={(event) => updateOptions({ enableCrossPartitionQueries: event.target.checked })}
          />
          Cross partition
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.returnRequestCharge ?? true}
            onChange={(event) => updateOptions({ returnRequestCharge: event.target.checked })}
          />
          Request charge
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.allowSelfSignedEmulatorCertificate ?? connectMode === 'emulator'}
            onChange={(event) =>
              updateOptions({ allowSelfSignedEmulatorCertificate: event.target.checked })
            }
          />
          Emulator cert
        </label>
      </div>
    </div>
  )
}

function authModeForConnectMode(
  mode: CosmosDbConnectionOptions['connectMode'],
): CosmosDbConnectionOptions['authMode'] {
  if (mode === 'emulator') {
    return 'emulator'
  }
  if (mode === 'resource-token') {
    return 'resource-token'
  }
  if (mode === 'managed-identity') {
    return 'managed-identity'
  }
  if (mode === 'entra-id') {
    return 'entra-id'
  }
  if (mode === 'connection-string') {
    return 'connection-string'
  }
  return 'account-key'
}
