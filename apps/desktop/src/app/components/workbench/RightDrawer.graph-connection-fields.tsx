import type { ConnectionProfile, GraphConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

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
  const authMode = options.authMode ?? defaultAuthMode(connectionDraft.engine)
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
                authMode: event.target.value === 'neptune-iam' ? 'aws-sigv4' : authMode,
                useIamAuth: event.target.value === 'neptune-iam' ? true : options.useIamAuth,
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
            onChange={(event) =>
              updateOptions({ authMode: event.target.value as GraphConnectionOptions['authMode'] })
            }
          >
            <option value="none">None</option>
            <option value="basic">Basic</option>
            <option value="bearer-token">Bearer token</option>
            <option value="aws-sigv4">AWS SigV4</option>
          </select>
        </FormField>
      </div>

      <FormField label="Endpoint">
        <input
          aria-label="Graph endpoint URL"
          value={options.endpointUrl ?? ''}
          placeholder={endpointPlaceholder(connectionDraft.engine)}
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
      ) : null}

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.useTls ?? false}
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
            checked={options.explainByDefault ?? false}
            onChange={(event) => updateOptions({ explainByDefault: event.target.checked })}
          />
          Explain
        </label>
      </div>
    </div>
  )
}

function connectionModes(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') {
    return [
      { value: 'neo4j-http', label: 'Neo4j HTTP' },
      { value: 'neo4j-bolt', label: 'Bolt profile' },
      { value: 'connection-string', label: 'Connection string' },
    ] as const
  }
  if (engine === 'arango') {
    return [
      { value: 'arango-http', label: 'ArangoDB HTTP' },
      { value: 'connection-string', label: 'Connection string' },
    ] as const
  }
  if (engine === 'neptune') {
    return [
      { value: 'neptune-http', label: 'Neptune HTTP' },
      { value: 'neptune-iam', label: 'Neptune IAM' },
    ] as const
  }
  return [
    { value: 'gremlin-http', label: 'Gremlin HTTP' },
    { value: 'connection-string', label: 'Connection string' },
  ] as const
}

function queryLanguages(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') {
    return [
      { value: 'cypher', label: 'Cypher' },
      { value: 'opencypher', label: 'openCypher' },
    ] as const
  }
  if (engine === 'arango') {
    return [{ value: 'aql', label: 'AQL' }] as const
  }
  if (engine === 'neptune') {
    return [
      { value: 'gremlin', label: 'Gremlin' },
      { value: 'opencypher', label: 'openCypher' },
      { value: 'sparql', label: 'SPARQL' },
    ] as const
  }
  return [{ value: 'gremlin', label: 'Gremlin' }] as const
}

function defaultConnectMode(engine: ConnectionProfile['engine']): GraphConnectionOptions['connectMode'] {
  if (engine === 'neo4j') return 'neo4j-http'
  if (engine === 'arango') return 'arango-http'
  if (engine === 'neptune') return 'neptune-http'
  return 'gremlin-http'
}

function defaultAuthMode(engine: ConnectionProfile['engine']): GraphConnectionOptions['authMode'] {
  if (engine === 'neptune') return 'none'
  return 'basic'
}

function defaultLanguage(engine: ConnectionProfile['engine']): GraphConnectionOptions['defaultQueryLanguage'] {
  if (engine === 'neo4j') return 'cypher'
  if (engine === 'arango') return 'aql'
  if (engine === 'neptune') return 'gremlin'
  return 'gremlin'
}

function endpointPlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') return 'http://localhost:7474'
  if (engine === 'arango') return 'http://localhost:8529'
  if (engine === 'neptune') return 'http://cluster.neptune.amazonaws.com:8182'
  return 'http://localhost:8182'
}

function databasePlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') return 'neo4j'
  if (engine === 'arango') return '_system'
  if (engine === 'janusgraph') return 'g'
  return 'graph'
}

function engineLabel(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') return 'Neo4j'
  if (engine === 'arango') return 'ArangoDB'
  if (engine === 'janusgraph') return 'JanusGraph'
  return 'Amazon Neptune'
}
