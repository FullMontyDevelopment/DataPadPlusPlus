import type { ConnectionProfile, GraphConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'
import {
  authenticationModes,
  connectionModes,
  databasePlaceholder,
  defaultAuthMode,
  defaultConnectMode,
  defaultLanguage,
  endpointPlaceholder,
  engineLabel,
  queryLanguages,
} from './RightDrawer.graph-connection-fields.helpers'

export function GraphConnectionFields({
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
  const options = connectionDraft.graphOptions ?? {}
  const connectMode = options.connectMode ?? defaultConnectMode(connectionDraft.engine)
  const authMode =
    options.authMode ??
    (connectMode === 'neptune-iam' ? 'aws-sigv4' : defaultAuthMode(connectionDraft.engine))
  const isIam = connectMode === 'neptune-iam'
  const showCredential = authMode === 'basic' || authMode === 'bearer-token'
  const updateOptions = (patch: Partial<GraphConnectionOptions>) =>
    onUpdateConnectionDraft({
      graphOptions: {
        connectMode,
        authMode,
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="Graph connection options">
      <strong>{engineLabel(connectionDraft.engine)} options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="Graph connection mode"
            value={connectMode}
            onChange={(event) =>
              updateOptions({
                connectMode: event.target.value as GraphConnectionOptions['connectMode'],
                authMode:
                  event.target.value === 'neptune-iam'
                    ? 'aws-sigv4'
                    : authMode === 'aws-sigv4'
                      ? defaultAuthMode(connectionDraft.engine)
                      : authMode,
                useIamAuth: event.target.value === 'neptune-iam' ? true : options.useIamAuth,
                useTls: event.target.value === 'neptune-iam' ? true : options.useTls,
                verifyCertificates:
                  event.target.value === 'neptune-iam' ? true : options.verifyCertificates,
              })
            }
          >
            {connectionModes(connectionDraft.engine).map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Auth">
          <select
            aria-label="Graph auth mode"
            value={authMode}
            disabled={isIam}
            onChange={(event) =>
              updateOptions({ authMode: event.target.value as GraphConnectionOptions['authMode'] })
            }
          >
            {authenticationModes(connectionDraft.engine, connectMode).map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Endpoint">
        <input
          aria-label="Graph endpoint URL"
          value={options.endpointUrl ?? ''}
          placeholder={endpointPlaceholder(connectionDraft.engine, connectMode)}
          onChange={(event) => {
            updateOptions({ endpointUrl: event.target.value || undefined })
            onUpdateConnectionDraft(
              { host: event.target.value || connectionDraft.host },
              { preserveName: true },
            )
          }}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label={connectionDraft.engine === 'arango' ? 'Database' : 'Database / graph'}>
          <input
            aria-label="Graph database"
            value={options.databaseName ?? connectionDraft.database ?? ''}
            placeholder={databasePlaceholder(connectionDraft.engine)}
            onChange={(event) => {
              updateOptions({ databaseName: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
        <FormField label="Path prefix">
          <input
            aria-label="Graph path prefix"
            disabled={isIam}
            value={options.pathPrefix ?? ''}
            placeholder="/proxy"
            onChange={(event) => updateOptions({ pathPrefix: event.target.value || undefined })}
          />
        </FormField>
      </div>

      {connectionDraft.engine === 'janusgraph' ? (
        <FormField label="Traversal source">
          <input
            aria-label="Graph traversal source"
            value={options.traversalSource ?? connectionDraft.database ?? ''}
            placeholder="g"
            onChange={(event) => {
              updateOptions({ traversalSource: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
      ) : null}

      {connectionDraft.engine === 'arango' ? (
        <FormField label="Graph name">
          <input
            aria-label="Graph name"
            value={options.graphName ?? ''}
            placeholder="fraudGraph"
            onChange={(event) => updateOptions({ graphName: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Query language">
          <select
            aria-label="Graph query language"
            value={options.defaultQueryLanguage ?? defaultLanguage(connectionDraft.engine)}
            onChange={(event) =>
              updateOptions({
                defaultQueryLanguage: event.target.value as GraphConnectionOptions['defaultQueryLanguage'],
              })
            }
          >
            {queryLanguages(connectionDraft.engine).map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Fetch size">
          <input
            aria-label="Graph fetch size"
            type="number"
            min={1}
            value={options.fetchSize ?? ''}
            onChange={(event) => updateOptions({ fetchSize: Number(event.target.value) || undefined })}
          />
        </FormField>
      </div>

      {authMode === 'basic' ? (
        <FormField label="User name">
          <input
            aria-label="Graph username"
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
          aria-label="Graph credential"
          type="password"
          autoComplete="new-password"
          disabled={!showCredential}
          value={showCredential ? secretDraft : ''}
          placeholder={
            connectionDraft.auth.secretRef
              ? 'Stored credential'
              : showCredential
                ? authMode === 'basic'
                  ? 'Password'
                  : 'Bearer token'
                : 'Not required'
          }
          onChange={(event) => onSecretDraftChange(event.target.value)}
        />
      </FormField>

      {authMode === 'aws-sigv4' || connectMode === 'neptune-iam' ? (
        <>
          <div className="connection-advanced-grid">
            <FormField label="AWS region">
              <input
                aria-label="Graph AWS region"
                value={options.awsRegion ?? ''}
                placeholder="us-east-1"
                onChange={(event) => updateOptions({ awsRegion: event.target.value || undefined })}
              />
            </FormField>
            <FormField label="AWS profile">
              <input
                aria-label="Graph AWS profile"
                value={options.awsProfileName ?? ''}
                placeholder="default"
                onChange={(event) =>
                  updateOptions({ awsProfileName: event.target.value || undefined })
                }
              />
            </FormField>
          </div>
          <FormField label="Role ARN">
            <input
              aria-label="Graph AWS role ARN"
              value={options.awsRoleArn ?? ''}
              placeholder="arn:aws:iam::123456789012:role/DataPadNeptune"
              onChange={(event) => updateOptions({ awsRoleArn: event.target.value || undefined })}
            />
          </FormField>
        </>
      ) : null}

      {(options.useTls || connectMode === 'neo4j-bolt') && !isIam ? (
        <>
          <FormField label="CA certificate">
            <input
              aria-label="Graph CA certificate path"
              value={options.caCertificatePath ?? ''}
              onChange={(event) =>
                updateOptions({ caCertificatePath: event.target.value || undefined })
              }
            />
          </FormField>
          <div className="connection-advanced-grid">
            <FormField label="Client certificate">
              <input
                aria-label="Graph client certificate path"
                value={options.clientCertificatePath ?? ''}
                onChange={(event) =>
                  updateOptions({ clientCertificatePath: event.target.value || undefined })
                }
              />
            </FormField>
            <FormField label="Client key">
              <input
                aria-label="Graph client key path"
                value={options.clientKeyPath ?? ''}
                onChange={(event) =>
                  updateOptions({ clientKeyPath: event.target.value || undefined })
                }
              />
            </FormField>
          </div>
        </>
      ) : null}

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={isIam || (options.useTls ?? false)}
            disabled={isIam}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={isIam || (options.verifyCertificates ?? true)}
            disabled={isIam}
            onChange={(event) => updateOptions({ verifyCertificates: event.target.checked })}
          />
          Verify certs
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
