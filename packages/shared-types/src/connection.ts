export const DATASTORE_FAMILIES = [
  'sql',
  'document',
  'keyvalue',
  'graph',
  'timeseries',
  'widecolumn',
  'search',
  'warehouse',
  'embedded-olap',
] as const

export type DatastoreFamily = (typeof DATASTORE_FAMILIES)[number]

export const DATASTORE_ENGINES = [
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'oracle',
  'mongodb',
  'dynamodb',
  'cassandra',
  'cosmosdb',
  'litedb',
  'redis',
  'valkey',
  'memcached',
  'neo4j',
  'neptune',
  'arango',
  'janusgraph',
  'influxdb',
  'timescaledb',
  'prometheus',
  'opentsdb',
  'elasticsearch',
  'opensearch',
  'clickhouse',
  'duckdb',
  'snowflake',
  'bigquery',
] as const

export type DatastoreEngine = (typeof DATASTORE_ENGINES)[number]

export const CONNECTION_MODES = [
  'native',
  'connection-string',
  'local-file',
  'cloud-iam',
  'cloud-sdk',
] as const

export type ConnectionMode = (typeof CONNECTION_MODES)[number]

export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'snowflake'] as const

export type CloudProvider = (typeof CLOUD_PROVIDERS)[number]

export const ENVIRONMENT_RISKS = ['low', 'medium', 'high', 'critical'] as const

export type EnvironmentRisk = (typeof ENVIRONMENT_RISKS)[number]

export const SECRET_PROVIDERS = ['os-keyring', 'manual', 'session'] as const

export type SecretProvider = (typeof SECRET_PROVIDERS)[number]

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export interface SecretRef {
  id: string
  provider: SecretProvider
  service: string
  account: string
  label: string
}

export interface ConnectionAuth {
  username?: string
  authMechanism?: string
  sslMode?: SslMode
  cloudProvider?: CloudProvider
  principal?: string
  secretRef?: SecretRef
}

export type SqliteOpenMode =
  | 'read-write'
  | 'read-only'
  | 'read-write-create'
  | 'memory'
  | 'shared-memory'
  | 'uri'

export type SqliteJournalMode =
  | 'delete'
  | 'truncate'
  | 'persist'
  | 'memory'
  | 'wal'
  | 'off'

export type SqliteSynchronousMode = 'off' | 'normal' | 'full' | 'extra'

export type SqliteCacheMode = 'default' | 'shared' | 'private'

export type SqliteTempStoreMode = 'default' | 'file' | 'memory'

export type SqliteLockingMode = 'normal' | 'exclusive'

export type SqliteAutoVacuumMode = 'none' | 'full' | 'incremental'

export interface SqliteConnectionOptions {
  openMode?: SqliteOpenMode
  useUriFilename?: boolean
  createIfMissing?: boolean
  immutable?: boolean
  sharedCache?: boolean
  privateCache?: boolean
  busyTimeoutMs?: number
  defaultTimeoutMs?: number
  journalMode?: SqliteJournalMode
  synchronousMode?: SqliteSynchronousMode
  cacheMode?: SqliteCacheMode
  cacheSize?: number
  pageSize?: number
  foreignKeys?: boolean
  recursiveTriggers?: boolean
  caseSensitiveLike?: boolean
  tempStoreMode?: SqliteTempStoreMode
  lockingMode?: SqliteLockingMode
  autoVacuum?: SqliteAutoVacuumMode
  mmapSize?: number
  applicationId?: number
  userVersion?: number
  encoding?: string
  encryptionProvider?: 'none' | 'sqlcipher' | 'provider-specific'
  encryptionKeySecretRef?: SecretRef
  cipherCompatibility?: string
  kdfIterations?: number
  cipherPageSize?: number
  hmacEnabled?: boolean
}

export type RedisDeploymentMode =
  | 'standalone'
  | 'tls'
  | 'sentinel'
  | 'cluster'
  | 'unix-socket'

export type RedisRespVersion = 'resp2' | 'resp3'

export interface RedisConnectionOptions {
  deploymentMode?: RedisDeploymentMode
  databaseIndex?: number
  useTls?: boolean
  clientName?: string
  respVersion?: RedisRespVersion
  connectionTimeoutMs?: number
  commandTimeoutMs?: number
  retryCount?: number
  retryDelayMs?: number
  keepAlive?: boolean
  autoReconnect?: boolean
  readOnlyMode?: boolean
  pipelineMode?: boolean
  compression?: string
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  certificatePasswordSecretRef?: SecretRef
  verifyServerCertificate?: boolean
  allowInvalidCertificates?: boolean
  allowInvalidHostnames?: boolean
  sentinelMasterName?: string
  sentinelHosts?: string[]
  sentinelUsername?: string
  sentinelPasswordSecretRef?: SecretRef
  useSentinelTls?: boolean
  clusterNodes?: string[]
  autoDiscoverClusterNodes?: boolean
  readFromReplicas?: boolean
  clusterRefreshIntervalMs?: number
  unixSocketPath?: string
}

export type SqlServerConnectMode =
  | 'tcp'
  | 'named-instance'
  | 'azure-sql'
  | 'localdb'
  | 'shared-memory'
  | 'named-pipes'

export type SqlServerAuthenticationMode =
  | 'sql-server'
  | 'windows'
  | 'azure-ad-password'
  | 'azure-ad-integrated'
  | 'azure-ad-interactive'
  | 'azure-ad-managed-identity'
  | 'azure-ad-service-principal'
  | 'certificate'

export type SqlServerApplicationIntent = 'default' | 'readwrite' | 'readonly'

export interface SqlServerConnectionOptions {
  connectMode?: SqlServerConnectMode
  instanceName?: string
  localDbInstance?: string
  namedPipePath?: string
  sharedMemoryServer?: string
  authenticationMode?: SqlServerAuthenticationMode
  azureTenantId?: string
  azureClientId?: string
  azureManagedIdentityClientId?: string
  servicePrincipalSecretRef?: SecretRef
  aadAccessTokenSecretRef?: SecretRef
  clientCertificatePath?: string
  certificateStore?: string
  certificateThumbprint?: string
  certificatePasswordSecretRef?: SecretRef
  encryptConnection?: boolean
  trustServerCertificate?: boolean
  trustServerCertificateCaPath?: string
  hostNameInCertificate?: string
  tlsVersion?: string
  certificateValidation?: 'default' | 'trust-server-certificate' | 'ca-file'
  connectionTimeoutMs?: number
  commandTimeoutMs?: number
  applicationName?: string
  multipleActiveResultSets?: boolean
  pooling?: boolean
  minPoolSize?: number
  maxPoolSize?: number
  packetSize?: number
  persistSecurityInfo?: boolean
  failoverPartner?: string
  multiSubnetFailover?: boolean
  readOnlyIntent?: boolean
  applicationIntent?: SqlServerApplicationIntent
  workstationId?: string
  language?: string
  networkLibrary?: string
  transparentNetworkIpResolution?: boolean
  connectRetryCount?: number
  connectRetryIntervalSeconds?: number
}

export type OracleConnectMode =
  | 'service-name'
  | 'sid'
  | 'tns-alias'
  | 'easy-connect'
  | 'tcps'
  | 'cloud-wallet'

export type OracleConnectionRole =
  | 'default'
  | 'sysdba'
  | 'sysoper'
  | 'sysbackup'
  | 'sysdg'
  | 'syskm'
  | 'sysrac'

export interface OracleConnectionOptions {
  connectMode?: OracleConnectMode
  serviceName?: string
  sid?: string
  tnsAlias?: string
  easyConnectString?: string
  connectionRole?: OracleConnectionRole
  proxyUser?: string
  clientIdentifier?: string
  applicationName?: string
  edition?: string
  nlsLanguage?: string
  nlsTerritory?: string
  statementCacheSize?: number
  fetchSize?: number
  connectionTimeoutMs?: number
  requestTimeoutMs?: number
  poolMin?: number
  poolMax?: number
  validateConnection?: boolean
  highAvailabilityEvents?: boolean
  loadBalancing?: boolean
  failover?: boolean
  useTls?: boolean
  walletPath?: string
  walletPasswordSecretRef?: SecretRef
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  traceDirectory?: string
}

export interface ConnectionProfile {
  id: string
  name: string
  engine: DatastoreEngine
  family: DatastoreFamily
  host: string
  port?: number
  database?: string
  connectionString?: string
  connectionMode?: ConnectionMode
  environmentIds: string[]
  tags: string[]
  favorite: boolean
  readOnly: boolean
  icon: string
  color?: string
  group?: string
  notes?: string
  auth: ConnectionAuth
  redisOptions?: RedisConnectionOptions
  sqliteOptions?: SqliteConnectionOptions
  sqlServerOptions?: SqlServerConnectionOptions
  oracleOptions?: OracleConnectionOptions
  createdAt: string
  updatedAt: string
}

export interface EnvironmentProfile {
  id: string
  label: string
  color: string
  risk: EnvironmentRisk
  inheritsFrom?: string
  variables: Record<string, string>
  sensitiveKeys: string[]
  requiresConfirmation: boolean
  safeMode: boolean
  exportable: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedEnvironment {
  environmentId: string
  label: string
  risk: EnvironmentRisk
  variables: Record<string, string>
  unresolvedKeys: string[]
  inheritedChain: string[]
  sensitiveKeys: string[]
}

export type ConnectionDefinition = ConnectionProfile
export type WorkspaceEnvironment = EnvironmentProfile
