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

export type DynamoDbConnectionMode =
  | 'local-endpoint'
  | 'aws-profile'
  | 'access-keys'
  | 'assume-role'
  | 'web-identity'
  | 'ecs-task'
  | 'ec2-instance'
  | 'endpoint-override'

export type DynamoDbCredentialsProvider =
  | 'default-chain'
  | 'profile'
  | 'static-keys'
  | 'session-token'
  | 'assume-role'
  | 'web-identity'
  | 'container'
  | 'instance-metadata'

export interface DynamoDbConnectionOptions {
  connectMode?: DynamoDbConnectionMode
  region?: string
  endpointUrl?: string
  tablePrefix?: string
  accountId?: string
  profileName?: string
  credentialsProvider?: DynamoDbCredentialsProvider
  accessKeyId?: string
  secretAccessKeyRef?: SecretRef
  sessionTokenRef?: SecretRef
  roleArn?: string
  externalId?: string
  roleSessionName?: string
  webIdentityTokenFile?: string
  useDualStackEndpoint?: boolean
  useFipsEndpoint?: boolean
  forcePathStyle?: boolean
  signerRegion?: string
  retryMode?: 'standard' | 'adaptive' | 'legacy'
  maxAttempts?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  readTimeoutMs?: number
  tcpKeepAlive?: boolean
  apiVersion?: string
  scanPageSize?: number
  consistentReadDefault?: boolean
  returnConsumedCapacity?: 'none' | 'total' | 'indexes'
}

export type CassandraConnectionMode =
  | 'contact-points'
  | 'connection-string'
  | 'secure-connect-bundle'

export type CassandraConsistencyLevel =
  | 'one'
  | 'two'
  | 'three'
  | 'quorum'
  | 'all'
  | 'local-quorum'
  | 'each-quorum'
  | 'local-one'
  | 'serial'
  | 'local-serial'

export interface CassandraConnectionOptions {
  connectMode?: CassandraConnectionMode
  contactPoints?: string[]
  defaultKeyspace?: string
  localDatacenter?: string
  protocolVersion?: 'v3' | 'v4' | 'v5' | 'dse-v1'
  authProvider?: 'none' | 'password' | 'kerberos' | 'secure-connect-bundle'
  secureConnectBundlePath?: string
  useTls?: boolean
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  certificatePasswordSecretRef?: SecretRef
  compression?: 'none' | 'lz4' | 'snappy'
  consistencyLevel?: CassandraConsistencyLevel
  serialConsistencyLevel?: CassandraConsistencyLevel
  loadBalancingPolicy?: 'token-aware' | 'dc-aware-round-robin' | 'round-robin'
  retryPolicy?: 'default' | 'fallthrough' | 'downgrading-consistency'
  pageSize?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  readTimeoutMs?: number
  heartbeatIntervalMs?: number
  applicationName?: string
  clientId?: string
  enableTracingDefault?: boolean
  allowBetaProtocol?: boolean
}

export type CosmosDbApiKind = 'nosql' | 'mongodb' | 'cassandra' | 'gremlin' | 'table'

export type CosmosDbConnectMode =
  | 'emulator'
  | 'account-endpoint'
  | 'connection-string'
  | 'entra-id'
  | 'managed-identity'
  | 'resource-token'

export type CosmosDbAuthMode =
  | 'emulator'
  | 'account-key'
  | 'resource-token'
  | 'entra-id'
  | 'managed-identity'
  | 'connection-string'

export type CosmosDbConsistencyLevel =
  | 'strong'
  | 'bounded-staleness'
  | 'session'
  | 'consistent-prefix'
  | 'eventual'

export interface CosmosDbConnectionOptions {
  connectMode?: CosmosDbConnectMode
  api?: CosmosDbApiKind
  accountEndpoint?: string
  accountName?: string
  databaseName?: string
  containerPrefix?: string
  authMode?: CosmosDbAuthMode
  accountKeySecretRef?: SecretRef
  resourceTokenSecretRef?: SecretRef
  tenantId?: string
  clientId?: string
  managedIdentityClientId?: string
  subscriptionId?: string
  resourceGroup?: string
  preferredRegions?: string[]
  writeRegion?: string
  consistencyLevel?: CosmosDbConsistencyLevel
  enableCrossPartitionQueries?: boolean
  maxItemCount?: number
  returnRequestCharge?: boolean
  gatewayMode?: 'gateway' | 'direct'
  useTls?: boolean
  allowSelfSignedEmulatorCertificate?: boolean
  retryMode?: 'fixed' | 'exponential'
  maxRetryAttempts?: number
  requestTimeoutMs?: number
  connectionTimeoutMs?: number
  applicationName?: string
}

export type SearchConnectionMode =
  | 'http'
  | 'elastic-cloud'
  | 'opensearch-managed'
  | 'aws-sigv4'
  | 'connection-string'

export type SearchAuthMode =
  | 'none'
  | 'basic'
  | 'api-key'
  | 'bearer-token'
  | 'service-token'
  | 'aws-sigv4'

export interface SearchConnectionOptions {
  connectMode?: SearchConnectionMode
  endpointUrl?: string
  cloudId?: string
  defaultIndex?: string
  pathPrefix?: string
  authMode?: SearchAuthMode
  username?: string
  apiKeyId?: string
  apiKeySecretRef?: SecretRef
  bearerTokenSecretRef?: SecretRef
  serviceTokenSecretRef?: SecretRef
  awsRegion?: string
  awsService?: 'es' | 'aoss'
  awsProfileName?: string
  awsRoleArn?: string
  verifyCertificates?: boolean
  useTls?: boolean
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  compression?: boolean
  requestTimeoutMs?: number
  connectionTimeoutMs?: number
  maxRetries?: number
  sniffOnStart?: boolean
  opaqueId?: string
}

export type TimeSeriesConnectionMode =
  | 'http'
  | 'cloud'
  | 'influx-v1'
  | 'influx-v2'
  | 'influx-v3'
  | 'opentsdb-http'

export type TimeSeriesAuthMode =
  | 'none'
  | 'basic'
  | 'bearer-token'
  | 'api-token'
  | 'custom-header'

export type TimeSeriesQueryLanguage = 'promql' | 'flux' | 'influxql' | 'sql' | 'opentsdb'

export interface TimeSeriesConnectionOptions {
  connectMode?: TimeSeriesConnectionMode
  endpointUrl?: string
  pathPrefix?: string
  organization?: string
  bucket?: string
  databaseName?: string
  retentionPolicy?: string
  defaultMetric?: string
  defaultRange?: string
  defaultStep?: string
  defaultQueryLanguage?: TimeSeriesQueryLanguage
  authMode?: TimeSeriesAuthMode
  username?: string
  tokenSecretRef?: SecretRef
  customHeaderName?: string
  customHeaderSecretRef?: SecretRef
  tenantHeaderName?: string
  tenantId?: string
  verifyCertificates?: boolean
  useTls?: boolean
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  connectionTimeoutMs?: number
  queryTimeoutMs?: number
  maxSeries?: number
  maxDataPoints?: number
}

export type GraphConnectionMode =
  | 'neo4j-http'
  | 'neo4j-bolt'
  | 'arango-http'
  | 'gremlin-http'
  | 'neptune-http'
  | 'neptune-iam'
  | 'connection-string'

export type GraphAuthMode = 'none' | 'basic' | 'bearer-token' | 'aws-sigv4'

export type GraphQueryLanguage = 'cypher' | 'aql' | 'gremlin' | 'opencypher' | 'sparql'

export interface GraphConnectionOptions {
  connectMode?: GraphConnectionMode
  endpointUrl?: string
  pathPrefix?: string
  databaseName?: string
  traversalSource?: string
  graphName?: string
  defaultQueryLanguage?: GraphQueryLanguage
  authMode?: GraphAuthMode
  username?: string
  tokenSecretRef?: SecretRef
  awsRegion?: string
  awsProfileName?: string
  awsRoleArn?: string
  useIamAuth?: boolean
  verifyCertificates?: boolean
  useTls?: boolean
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  connectionTimeoutMs?: number
  queryTimeoutMs?: number
  fetchSize?: number
  explainByDefault?: boolean
}

export type WarehouseConnectionMode =
  | 'snowflake-sql-api'
  | 'bigquery-rest'
  | 'clickhouse-http'
  | 'clickhouse-native'
  | 'duckdb-file'
  | 'duckdb-memory'
  | 'connection-string'

export type WarehouseAuthMode =
  | 'none'
  | 'basic'
  | 'bearer-token'
  | 'oauth'
  | 'service-account'
  | 'cloud-default'

export type WarehouseQueryLanguage =
  | 'snowflake-sql'
  | 'googlesql'
  | 'clickhouse-sql'
  | 'duckdb-sql'

export interface WarehouseConnectionOptions {
  connectMode?: WarehouseConnectionMode
  endpointUrl?: string
  pathPrefix?: string
  accountName?: string
  projectId?: string
  datasetId?: string
  databaseName?: string
  schemaName?: string
  warehouseName?: string
  roleName?: string
  catalogName?: string
  region?: string
  location?: string
  filePath?: string
  tempDirectory?: string
  memoryLimit?: string
  extensions?: string[]
  defaultQueryLanguage?: WarehouseQueryLanguage
  authMode?: WarehouseAuthMode
  username?: string
  tokenSecretRef?: SecretRef
  serviceAccountKeySecretRef?: SecretRef
  clientId?: string
  clientSecretRef?: SecretRef
  profileName?: string
  useTls?: boolean
  verifyCertificates?: boolean
  caCertificatePath?: string
  clientCertificatePath?: string
  clientKeyPath?: string
  connectionTimeoutMs?: number
  queryTimeoutMs?: number
  maxRows?: number
  threads?: number
  dryRunByDefault?: boolean
  explainByDefault?: boolean
  costLimitUsd?: number
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
  dynamoDbOptions?: DynamoDbConnectionOptions
  cassandraOptions?: CassandraConnectionOptions
  cosmosDbOptions?: CosmosDbConnectionOptions
  searchOptions?: SearchConnectionOptions
  timeSeriesOptions?: TimeSeriesConnectionOptions
  graphOptions?: GraphConnectionOptions
  warehouseOptions?: WarehouseConnectionOptions
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
  variableDefinitions?: EnvironmentVariableDefinition[]
  requiresConfirmation: boolean
  safeMode: boolean
  exportable: boolean
  createdAt: string
  updatedAt: string
}

export type EnvironmentVariableKind = 'text' | 'secret'

export interface EnvironmentVariableDefinition {
  key: string
  kind: EnvironmentVariableKind
  value?: string
  secretRef?: SecretRef
  updatedAt?: string
}

export interface ResolvedEnvironment {
  environmentId: string
  label: string
  risk: EnvironmentRisk
  variables: Record<string, string>
  unresolvedKeys: string[]
  inheritedChain: string[]
  sensitiveKeys: string[]
  variableDefinitions?: EnvironmentVariableDefinition[]
}

export type ConnectionDefinition = ConnectionProfile
export type WorkspaceEnvironment = EnvironmentProfile
