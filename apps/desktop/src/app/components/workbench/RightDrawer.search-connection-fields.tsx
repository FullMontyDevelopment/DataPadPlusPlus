import type { ConnectionMode, ConnectionProfile, SearchConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function SearchConnectionFields({
  connectionDraft,
  mode,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  mode: Extract<ConnectionMode, 'native' | 'cloud-iam' | 'cloud-sdk'>
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.searchOptions ?? {}
  const connectMode = options.connectMode ?? defaultConnectMode(connectionDraft.engine, mode)
  const authMode = options.authMode ?? defaultAuthMode(connectMode)
  const showCredential =
    authMode === 'basic' ||
    authMode === 'api-key' ||
    authMode === 'bearer-token' ||
    authMode === 'service-token'
  const updateOptions = (patch: Partial<SearchConnectionOptions>) =>
    onUpdateConnectionDraft({
      searchOptions: {
        connectMode,
        authMode,
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="Search connection options">
      <strong>{connectionDraft.engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'} options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="Search connection mode"
            value={connectMode}
            onChange={(event) => {
              const nextMode = event.target.value as SearchConnectionOptions['connectMode']
              updateOptions({ connectMode: nextMode, authMode: defaultAuthMode(nextMode) })
            }}
          >
            <option value="http">HTTP endpoint</option>
            <option value="elastic-cloud">Elastic Cloud</option>
            <option value="opensearch-managed">Managed OpenSearch</option>
            <option value="aws-sigv4">AWS SigV4</option>
            <option value="connection-string">Connection string</option>
          </select>
        </FormField>
        <FormField label="Auth">
          <select
            aria-label="Search auth mode"
            value={authMode}
            onChange={(event) =>
              updateOptions({ authMode: event.target.value as SearchConnectionOptions['authMode'] })
            }
          >
            <option value="none">None</option>
            <option value="basic">Basic</option>
            <option value="api-key">API key</option>
            <option value="bearer-token">Bearer token</option>
            <option value="service-token">Service token</option>
            <option value="aws-sigv4">AWS SigV4</option>
          </select>
        </FormField>
      </div>

      {mode === 'cloud-iam' || connectMode !== 'http' ? (
        <FormField label={connectMode === 'elastic-cloud' ? 'Cloud endpoint' : 'Endpoint'}>
          <input
            aria-label="Search endpoint URL"
            value={options.endpointUrl ?? connectionDraft.host ?? ''}
            placeholder="http://localhost:9200 or https://cluster.example.com"
            onChange={(event) => {
              updateOptions({ endpointUrl: event.target.value || undefined })
              onUpdateConnectionDraft({ host: event.target.value || '' }, { preserveName: true })
            }}
          />
        </FormField>
      ) : null}

      {connectMode === 'elastic-cloud' ? (
        <FormField label="Cloud ID">
          <input
            aria-label="Search cloud id"
            value={options.cloudId ?? ''}
            onChange={(event) => updateOptions({ cloudId: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Default index">
          <input
            aria-label="Search default index"
            value={options.defaultIndex ?? connectionDraft.database ?? ''}
            placeholder="logs-*"
            onChange={(event) => {
              updateOptions({ defaultIndex: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
        <FormField label="Path prefix">
          <input
            aria-label="Search path prefix"
            value={options.pathPrefix ?? ''}
            placeholder="/elastic"
            onChange={(event) => updateOptions({ pathPrefix: event.target.value || undefined })}
          />
        </FormField>
      </div>

      {authMode === 'basic' ? (
        <FormField label="User name">
          <input
            aria-label="Search username"
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

      {authMode === 'api-key' ? (
        <FormField label="Key ID">
          <input
            aria-label="Search API key id"
            value={options.apiKeyId ?? ''}
            onChange={(event) => updateOptions({ apiKeyId: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      <FormField label="Credential">
        <input
          aria-label="Search credential"
          type="password"
          autoComplete="new-password"
          disabled={!showCredential}
          value={showCredential ? secretDraft : ''}
          placeholder={connectionDraft.auth.secretRef ? 'Stored credential' : showCredential ? credentialPlaceholder(authMode) : 'Not required'}
          onChange={(event) => onSecretDraftChange(event.target.value)}
        />
      </FormField>

      {authMode === 'aws-sigv4' || connectMode === 'aws-sigv4' ? (
        <div className="connection-advanced-grid">
          <FormField label="AWS region">
            <input
              aria-label="Search AWS region"
              value={options.awsRegion ?? ''}
              placeholder="us-east-1"
              onChange={(event) => updateOptions({ awsRegion: event.target.value || undefined })}
            />
          </FormField>
          <FormField label="AWS service">
            <select
              aria-label="Search AWS service"
              value={options.awsService ?? 'es'}
              onChange={(event) =>
                updateOptions({ awsService: event.target.value as SearchConnectionOptions['awsService'] })
              }
            >
              <option value="es">OpenSearch / Elasticsearch</option>
              <option value="aoss">OpenSearch Serverless</option>
            </select>
          </FormField>
          <FormField label="Profile">
            <input
              aria-label="Search AWS profile"
              value={options.awsProfileName ?? ''}
              placeholder="default"
              onChange={(event) => updateOptions({ awsProfileName: event.target.value || undefined })}
            />
          </FormField>
          <FormField label="Role ARN">
            <input
              aria-label="Search AWS role ARN"
              value={options.awsRoleArn ?? ''}
              onChange={(event) => updateOptions({ awsRoleArn: event.target.value || undefined })}
            />
          </FormField>
        </div>
      ) : null}

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.useTls ?? connectMode !== 'http'}
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
            checked={options.compression ?? true}
            onChange={(event) => updateOptions({ compression: event.target.checked })}
          />
          Compression
        </label>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Connect timeout ms">
          <input
            aria-label="Search connection timeout"
            type="number"
            min={1}
            value={options.connectionTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ connectionTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Request timeout ms">
          <input
            aria-label="Search request timeout"
            type="number"
            min={1}
            value={options.requestTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ requestTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>
    </div>
  )
}

function defaultConnectMode(
  engine: ConnectionProfile['engine'],
  mode: Extract<ConnectionMode, 'native' | 'cloud-iam' | 'cloud-sdk'>,
): SearchConnectionOptions['connectMode'] {
  if (mode === 'cloud-iam' || mode === 'cloud-sdk') {
    return engine === 'opensearch' ? 'aws-sigv4' : 'elastic-cloud'
  }
  return 'http'
}

function defaultAuthMode(
  mode: SearchConnectionOptions['connectMode'],
): SearchConnectionOptions['authMode'] {
  if (mode === 'aws-sigv4') return 'aws-sigv4'
  if (mode === 'elastic-cloud') return 'api-key'
  if (mode === 'opensearch-managed') return 'basic'
  return 'none'
}

function credentialPlaceholder(authMode: SearchConnectionOptions['authMode']) {
  if (authMode === 'api-key') return 'API key secret'
  if (authMode === 'bearer-token') return 'Bearer token'
  if (authMode === 'service-token') return 'Service token'
  return 'Password'
}
