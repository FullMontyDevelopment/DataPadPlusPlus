import type { ConnectionProfile, MemcachedConnectionOptions } from '@datapadplusplus/shared-types'
import { FormField } from './RightDrawer.primitives'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'

interface MemcachedConnectionFieldsProps {
  connectionDraft: ConnectionProfile
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}

export function MemcachedConnectionFields({
  connectionDraft,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: MemcachedConnectionFieldsProps) {
  const options = connectionDraft.memcachedOptions ?? {}
  const servers = options.servers?.length
    ? options.servers
    : [serverFromConnection(connectionDraft)]

  const updateOptions = (patch: Partial<MemcachedConnectionOptions>) =>
    onUpdateConnectionDraft({
      memcachedOptions: {
        ...options,
        ...patch,
      },
    })

  const updateServers = (value: string) => {
    const parsedServers = value
      .split(/\r?\n|,/)
      .map((server) => server.trim())
      .filter(Boolean)
    const firstServer = parseServer(parsedServers[0])

    onUpdateConnectionDraft({
      host: firstServer?.host ?? connectionDraft.host,
      port: firstServer?.port ?? connectionDraft.port,
      memcachedOptions: {
        ...options,
        servers: parsedServers,
      },
    })
  }

  return (
    <div className="connection-advanced-section" aria-label="Memcached connection options">
      <div className="connection-flags-title">
        <span>Memcached options</span>
      </div>

      <FormField label="Memcached servers">
        <textarea
          aria-label="Memcached servers"
          value={servers.join('\n')}
          placeholder="cache-a.example.com:11211"
          onChange={(event) => updateServers(event.target.value)}
        />
      </FormField>

      <div className="drawer-grid drawer-grid--two">
        <FormField label="Memcached protocol">
          <select
            aria-label="Memcached protocol"
            value={options.protocol ?? 'text'}
            onChange={(event) =>
              updateOptions({ protocol: event.target.value as MemcachedConnectionOptions['protocol'] })
            }
          >
            <option value="text">Text</option>
            <option value="binary">Binary</option>
          </select>
        </FormField>

        <FormField label="Memcached auth mode">
          <select
            aria-label="Memcached auth mode"
            value={options.authMode ?? 'none'}
            onChange={(event) =>
              updateOptions({ authMode: event.target.value as MemcachedConnectionOptions['authMode'] })
            }
          >
            <option value="none">None</option>
            <option value="sasl-plain">SASL plain</option>
          </select>
        </FormField>
      </div>

      <FormField label="Memcached username">
        <input
          aria-label="Memcached username"
          value={options.username ?? ''}
          placeholder="Optional SASL user"
          onChange={(event) => updateOptions({ username: event.target.value || undefined })}
        />
      </FormField>

      <FormField label="Memcached credential">
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Memcached credential"
          value={secretDraft}
          placeholder={
            options.saslPasswordSecretRef || connectionDraft.auth.secretRef
              ? 'Stored credential'
              : 'Optional SASL password'
          }
          onChange={(event) => onSecretDraftChange(event.target.value)}
        />
      </FormField>

      <div className="drawer-grid drawer-grid--two">
        <FormField label="Memcached namespace prefix">
          <input
            aria-label="Memcached namespace prefix"
            value={options.namespacePrefix ?? ''}
            placeholder="app:"
            onChange={(event) => updateOptions({ namespacePrefix: event.target.value || undefined })}
          />
        </FormField>

        <FormField label="Memcached default TTL">
          <input
            aria-label="Memcached default TTL"
            type="number"
            min={0}
            value={options.defaultTtlSeconds ?? ''}
            onChange={(event) =>
              updateOptions({ defaultTtlSeconds: numericValue(event.target.value) })
            }
          />
        </FormField>
      </div>

      <div className="drawer-grid drawer-grid--two">
        <FormField label="Memcached connection timeout">
          <input
            aria-label="Memcached connection timeout"
            type="number"
            min={1}
            value={options.connectTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ connectTimeoutMs: numericValue(event.target.value) })
            }
          />
        </FormField>

        <FormField label="Memcached request timeout">
          <input
            aria-label="Memcached request timeout"
            type="number"
            min={1}
            value={options.requestTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ requestTimeoutMs: numericValue(event.target.value) })
            }
          />
        </FormField>
      </div>

      <div className="drawer-grid drawer-grid--two">
        <FormField label="Memcached flush delay">
          <input
            aria-label="Memcached flush delay"
            type="number"
            min={0}
            value={options.flushDelaySeconds ?? ''}
            onChange={(event) =>
              updateOptions({ flushDelaySeconds: numericValue(event.target.value) })
            }
          />
        </FormField>

        <FormField label="Memcached max value bytes">
          <input
            aria-label="Memcached max value bytes"
            type="number"
            min={1}
            value={options.maxValueBytes ?? ''}
            onChange={(event) => updateOptions({ maxValueBytes: numericValue(event.target.value) })}
          />
        </FormField>
      </div>

      <div className="drawer-toggle-row drawer-toggle-row--wrap">
        <button
          type="button"
          className={`drawer-toggle${options.tcpNoDelay ? ' is-active' : ''}`}
          onClick={() => updateOptions({ tcpNoDelay: !options.tcpNoDelay })}
        >
          TCP no-delay
        </button>
        <button
          type="button"
          className={`drawer-toggle${options.keepAlive ? ' is-active' : ''}`}
          onClick={() => updateOptions({ keepAlive: !options.keepAlive })}
        >
          Keep-alive
        </button>
        <button
          type="button"
          className={`drawer-toggle${options.lruCrawlerEnabled ? ' is-active' : ''}`}
          onClick={() => updateOptions({ lruCrawlerEnabled: !options.lruCrawlerEnabled })}
        >
          LRU crawler
        </button>
        <button
          type="button"
          className={`drawer-toggle${options.readOnlyMode ? ' is-active' : ''}`}
          onClick={() => updateOptions({ readOnlyMode: !options.readOnlyMode })}
        >
          Native read-only
        </button>
      </div>
    </div>
  )
}

function serverFromConnection(connection: ConnectionProfile) {
  return `${connection.host || 'localhost'}:${connection.port ?? 11211}`
}

function parseServer(server: string | undefined) {
  if (!server) {
    return undefined
  }
  const trimmed = server.trim()
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon <= 0 || lastColon === trimmed.length - 1) {
    return { host: trimmed, port: undefined }
  }
  const port = Number(trimmed.slice(lastColon + 1))
  return {
    host: trimmed.slice(0, lastColon),
    port: Number.isInteger(port) && port > 0 ? port : undefined,
  }
}

function numericValue(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
