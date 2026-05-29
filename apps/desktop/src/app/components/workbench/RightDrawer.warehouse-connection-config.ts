import type {
  ConnectionProfile,
  WarehouseAuthMode,
  WarehouseConnectionOptions,
} from '@datapadplusplus/shared-types'

export const warehouseCredentialAuthModes = new Set<WarehouseAuthMode>([
  'basic',
  'bearer-token',
  'oauth',
  'service-account',
])

export function warehouseConnectionModes(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') {
    return [
      { value: 'snowflake-sql-api', label: 'SQL API' },
      { value: 'connection-string', label: 'Connection string' },
    ]
  }

  if (engine === 'bigquery') {
    return [
      { value: 'bigquery-rest', label: 'REST / GoogleSQL' },
      { value: 'connection-string', label: 'Connection string' },
    ]
  }

  if (engine === 'clickhouse') {
    return [
      { value: 'clickhouse-http', label: 'HTTP' },
      { value: 'clickhouse-native', label: 'Native profile' },
      { value: 'connection-string', label: 'Connection string' },
    ]
  }

  return [
    { value: 'duckdb-file', label: 'Local file' },
    { value: 'duckdb-memory', label: 'Memory' },
    { value: 'connection-string', label: 'Connection string' },
  ]
}

export function warehouseAuthModes(engine: ConnectionProfile['engine']) {
  if (engine === 'bigquery') {
    return [
      { value: 'cloud-default', label: 'Google ADC' },
      { value: 'bearer-token', label: 'Bearer token' },
      { value: 'service-account', label: 'Service account' },
      { value: 'none', label: 'None' },
    ]
  }

  if (engine === 'snowflake') {
    return [
      { value: 'oauth', label: 'OAuth token' },
      { value: 'bearer-token', label: 'Programmatic token' },
      { value: 'basic', label: 'User/password' },
      { value: 'none', label: 'None' },
    ]
  }

  if (engine === 'clickhouse') {
    return [
      { value: 'basic', label: 'User/password' },
      { value: 'bearer-token', label: 'Bearer token' },
      { value: 'none', label: 'None' },
    ]
  }

  return [{ value: 'none', label: 'None' }]
}

export function warehouseQueryLanguages(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') return [{ value: 'snowflake-sql', label: 'Snowflake SQL' }]
  if (engine === 'bigquery') return [{ value: 'googlesql', label: 'GoogleSQL' }]
  if (engine === 'clickhouse') return [{ value: 'clickhouse-sql', label: 'ClickHouse SQL' }]
  return [{ value: 'duckdb-sql', label: 'DuckDB SQL' }]
}

export function defaultWarehouseConnectMode(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') return 'snowflake-sql-api'
  if (engine === 'bigquery') return 'bigquery-rest'
  if (engine === 'clickhouse') return 'clickhouse-http'
  return 'duckdb-file'
}

export function defaultWarehouseAuthMode(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') return 'oauth'
  if (engine === 'bigquery') return 'cloud-default'
  if (engine === 'clickhouse') return 'basic'
  return 'none'
}

export function defaultWarehouseAuthModeForMode(
  engine: ConnectionProfile['engine'],
  mode?: WarehouseConnectionOptions['connectMode'],
) {
  if (mode === 'duckdb-file' || mode === 'duckdb-memory') return 'none'
  return defaultWarehouseAuthMode(engine)
}

export function defaultWarehouseLanguage(engine: ConnectionProfile['engine']) {
  return warehouseQueryLanguages(engine)[0]?.value
}

export function warehouseEngineLabel(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') return 'Snowflake'
  if (engine === 'bigquery') return 'BigQuery'
  if (engine === 'clickhouse') return 'ClickHouse'
  if (engine === 'duckdb') return 'DuckDB'
  return 'Warehouse'
}

export function warehouseCredentialPlaceholder(authMode: WarehouseAuthMode) {
  if (authMode === 'service-account') return 'Service account JSON'
  if (authMode === 'oauth') return 'OAuth token'
  if (authMode === 'bearer-token') return 'Bearer token'
  return 'Password'
}
