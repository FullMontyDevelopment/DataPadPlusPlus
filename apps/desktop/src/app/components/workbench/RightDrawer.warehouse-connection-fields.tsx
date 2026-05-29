import type { ConnectionProfile, WarehouseConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'
import {
  defaultWarehouseAuthMode,
  defaultWarehouseAuthModeForMode,
  defaultWarehouseConnectMode,
  defaultWarehouseLanguage,
  warehouseAuthModes,
  warehouseConnectionModes,
  warehouseCredentialAuthModes,
  warehouseCredentialPlaceholder,
  warehouseEngineLabel,
  warehouseQueryLanguages,
} from './RightDrawer.warehouse-connection-config'
import {
  DuckDbFields,
  RemoteWarehouseFields,
} from './RightDrawer.warehouse-engine-fields'

export function WarehouseConnectionFields({
  connectionDraft,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.warehouseOptions ?? {}
  const connectMode = options.connectMode ?? defaultWarehouseConnectMode(connectionDraft.engine)
  const authMode = options.authMode ?? defaultWarehouseAuthMode(connectionDraft.engine)
  const showCredential = warehouseCredentialAuthModes.has(authMode)
  const updateOptions = (patch: Partial<WarehouseConnectionOptions>) =>
    onUpdateConnectionDraft({
      warehouseOptions: {
        connectMode,
        authMode,
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="Warehouse connection options">
      <strong>{warehouseEngineLabel(connectionDraft.engine)} options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="Warehouse connection mode"
            value={connectMode}
            onChange={(event) => {
              const nextMode = event.target.value as WarehouseConnectionOptions['connectMode']
              updateOptions({
                connectMode: nextMode,
                authMode: defaultWarehouseAuthModeForMode(connectionDraft.engine, nextMode),
              })
            }}
          >
            {warehouseConnectionModes(connectionDraft.engine).map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Auth">
          <select
            aria-label="Warehouse auth mode"
            value={authMode}
            onChange={(event) =>
              updateOptions({
                authMode: event.target.value as WarehouseConnectionOptions['authMode'],
              })
            }
          >
            {warehouseAuthModes(connectionDraft.engine).map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {connectionDraft.engine === 'duckdb' ? (
        <DuckDbFields
          connectionDraft={connectionDraft}
          options={options}
          updateOptions={updateOptions}
          onUpdateConnectionDraft={onUpdateConnectionDraft}
        />
      ) : (
        <RemoteWarehouseFields
          connectionDraft={connectionDraft}
          options={options}
          updateOptions={updateOptions}
          onUpdateConnectionDraft={onUpdateConnectionDraft}
        />
      )}

      {authMode === 'basic' ? (
        <FormField label="User name">
          <input
            aria-label="Warehouse username"
            value={options.username ?? connectionDraft.auth.username ?? ''}
            onChange={(event) => {
              updateOptions({ username: event.target.value || undefined })
              onUpdateConnectionDraft({
                auth: { ...connectionDraft.auth, username: event.target.value || undefined },
              })
            }}
          />
        </FormField>
      ) : null}

      <FormField label="Credential">
        <input
          aria-label="Warehouse credential"
          type="password"
          autoComplete="new-password"
          disabled={!showCredential}
          value={showCredential ? secretDraft : ''}
          placeholder={
            connectionDraft.auth.secretRef
              ? 'Stored credential'
              : showCredential
                ? warehouseCredentialPlaceholder(authMode)
                : 'Not required'
          }
          onChange={(event) => onSecretDraftChange(event.target.value)}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Query language">
          <select
            aria-label="Warehouse query language"
            value={options.defaultQueryLanguage ?? defaultWarehouseLanguage(connectionDraft.engine)}
            onChange={(event) =>
              updateOptions({
                defaultQueryLanguage: event.target
                  .value as WarehouseConnectionOptions['defaultQueryLanguage'],
              })
            }
          >
            {warehouseQueryLanguages(connectionDraft.engine).map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Max rows">
          <input
            aria-label="Warehouse max rows"
            type="number"
            min={1}
            value={options.maxRows ?? ''}
            onChange={(event) => updateOptions({ maxRows: Number(event.target.value) || undefined })}
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Query timeout ms">
          <input
            aria-label="Warehouse query timeout"
            type="number"
            min={1}
            value={options.queryTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ queryTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Cost limit">
          <input
            aria-label="Warehouse cost limit"
            type="number"
            min={0}
            step="0.01"
            value={options.costLimitUsd ?? ''}
            onChange={(event) =>
              updateOptions({ costLimitUsd: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.useTls ?? connectionDraft.engine !== 'clickhouse'}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.verifyCertificates ?? true}
            onChange={(event) => updateOptions({ verifyCertificates: event.target.checked })}
          />
          Verify certs
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.dryRunByDefault ?? connectionDraft.engine === 'bigquery'}
            onChange={(event) => updateOptions({ dryRunByDefault: event.target.checked })}
          />
          Dry run
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.explainByDefault ?? false}
            onChange={(event) => updateOptions({ explainByDefault: event.target.checked })}
          />
          Explain
        </label>
      </div>
    </div>
  )
}
