import type {
  DatastoreEngine,
  DatastoreOperationExecutionSupport,
  DatastoreTransferAction,
  DatastoreTransferCapability,
  DatastoreTransferDestinationKind,
  DatastoreTransferFidelity,
  DatastoreTransferFormat,
  DatastoreTransferManifest,
  DatastoreTransferOption,
} from '@datapadplusplus/shared-types'

type FormatSpec = [id: string, label: string, fidelity: DatastoreTransferFidelity, extensions: string[], description: string, warning?: string]
type CapabilitySpec = {
  actions: DatastoreTransferAction[]
  formats: FormatSpec[]
  destinations?: DatastoreTransferDestinationKind[]
  support?: DatastoreOperationExecutionSupport
  supportByAction?: Partial<Record<DatastoreTransferAction, DatastoreOperationExecutionSupport>>
  operationIds?: Partial<Record<DatastoreTransferAction, string>>
  options?: Partial<Record<DatastoreTransferAction, DatastoreTransferOption[]>>
  description: string
  disabledReason?: string
  disabledReasonByAction?: Partial<Record<DatastoreTransferAction, string>>
  multiple?: boolean
  requiresExistingTarget?: boolean
}

const portableCsv: FormatSpec = ['csv', 'CSV', 'portable-lossy', ['csv'], 'Portable delimited rows.', 'CSV can lose nested values and datastore-specific type information.']
const portableJson: FormatSpec = ['json', 'JSON', 'portable', ['json'], 'Portable JSON document or row array.']
const portableNdjson: FormatSpec = ['ndjson', 'NDJSON', 'portable', ['ndjson', 'jsonl'], 'One JSON document or row per line.']
const postgresText: FormatSpec = ['text', 'PostgreSQL COPY text', 'native', ['txt'], 'Native PostgreSQL text COPY stream.']
const postgresBinary: FormatSpec = ['binary-copy', 'PostgreSQL binary COPY', 'native', ['bin'], 'Lossless PostgreSQL binary COPY stream. Binary imports require the same ordered column types.']

const DATA_SPECS: Record<DatastoreEngine, CapabilitySpec> = {
  postgresql: liveData('PostgreSQL streams native text, CSV, and binary data through driver-level COPY. JSON and NDJSON remain portable conversions.', [postgresText, ['csv', 'PostgreSQL COPY CSV', 'native', ['csv'], 'Native PostgreSQL CSV COPY stream with a header row.'], postgresBinary, portableJson, portableNdjson]),
  mysql: liveData('MySQL uses guarded local or server file loading and streamed row export.', [portableCsv, portableJson, portableNdjson]),
  mariadb: liveData('MariaDB uses guarded local or server file loading and streamed row export.', [portableCsv, portableJson, portableNdjson]),
  sqlserver: liveData('SQL Server validates identity, computed, collation, temporal, binary, and GUID columns before transfer.', [portableCsv, portableJson, portableNdjson]),
  sqlite: liveData('SQLite transfers rows into an existing table.', [portableCsv, portableJson, portableNdjson], {
    import: 'sqlite.table.import',
    export: 'sqlite.table.export',
  }),
  mongodb: liveData('MongoDB preserves native BSON values through Extended JSON or BSON document streams.', [
    ['extended-json', 'Canonical Extended JSON', 'native', ['json'], 'Canonical MongoDB Extended JSON.'],
    ['bson', 'BSON sequence', 'native', ['bson'], 'Lossless consecutive BSON documents.'],
    portableNdjson,
    portableCsv,
  ], {
    import: 'mongodb.collection.import',
    export: 'mongodb.collection.export',
  }),
  redis: liveData('Redis exports and restores explicit keys with protocol-native serialized values and TTL evidence.', [
    portableJson,
    portableNdjson,
  ], { import: 'redis.key.import', export: 'redis.key.export' }, false),
  valkey: liveData('Valkey exports and restores explicit keys with protocol-native serialized values and TTL evidence.', [
    portableJson,
    portableNdjson,
  ], { import: 'valkey.key.import', export: 'valkey.key.export' }, false),
  litedb: liveData('LiteDB collection transfer uses Extended JSON through the bundled sidecar.', [
    ['json', 'LiteDB Extended JSON', 'native', ['json'], 'LiteDB Extended JSON with native wrappers.'],
    portableNdjson,
  ]),
  duckdb: liveData('DuckDB uses native COPY for table data.', [portableCsv, ['json', 'DuckDB JSON', 'native', ['json'], 'DuckDB JSON output.'], ['parquet', 'Parquet', 'native', ['parquet'], 'DuckDB Parquet data.']]),
  cockroachdb: {
    actions: ['import', 'export'],
    formats: [['csv', 'CockroachDB CSV', 'native', ['csv'], 'CockroachDB native CSV files in a server-side storage prefix.']],
    destinations: ['cloud-uri', 'server-path'],
    support: 'live',
    description: 'CockroachDB exports native CSV to server-accessible storage and imports into an existing empty table through a monitored IMPORT job. Destinations must use credential-free external, userfile, or node-local references.',
    multiple: true,
    requiresExistingTarget: true,
  },
  timescaledb: liveData('TimescaleDB streams PostgreSQL COPY data after validating hypertable metadata, the native time dimension, compression state, and any requested export window.', [postgresText, ['csv', 'PostgreSQL COPY CSV', 'native', ['csv'], 'Native PostgreSQL CSV COPY stream with a header row.'], postgresBinary], undefined, true, {
    export: [
      {
        id: 'timeColumn',
        label: 'Time column',
        input: 'text',
        required: false,
        placeholder: 'Detected from the hypertable',
        description: 'Optional. When supplied, it must match the hypertable’s native time dimension.',
      },
      {
        id: 'start',
        label: 'Window start',
        input: 'text',
        required: false,
        requiredWith: ['end'],
        placeholder: '2026-01-01T00:00:00Z',
        description: 'Timezone-bearing ISO-8601 value. Start and end must be supplied together.',
      },
      {
        id: 'end',
        label: 'Window end',
        input: 'text',
        required: false,
        requiredWith: ['start'],
        placeholder: '2026-02-01T00:00:00Z',
        description: 'Exclusive timezone-bearing ISO-8601 upper bound.',
      },
    ],
  }),
  oracle: liveData('Oracle streams CSV through the bundled managed driver and imports into an existing empty table with array binding and exact column validation.', [portableCsv], undefined, false),
  elasticsearch: liveSearchData('Elasticsearch exports with PIT/search-after and imports into a new rollback-safe index through conflict-safe Bulk create actions.'),
  opensearch: liveSearchData('OpenSearch exports with version-compatible scroll paging and imports into a new rollback-safe index through conflict-safe Bulk create actions.'),
  clickhouse: liveData('ClickHouse streams native SELECT FORMAT and INSERT FORMAT payloads through its HTTP interface. Imports require an existing empty table so the fail-safe conflict policy cannot append to existing data.', [['csv', 'CSVWithNames', 'native', ['csv'], 'ClickHouse CSV data with a native column-name header.'], ['tsv', 'TabSeparatedWithNames', 'native', ['tsv'], 'ClickHouse tab-separated data with a native column-name header.'], ['json-each-row', 'JSONEachRow', 'native', ['jsonl'], 'ClickHouse JSONEachRow data.'], ['parquet', 'Parquet', 'native', ['parquet'], 'ClickHouse Parquet data.']]),
  cassandra: liveData('Cassandra streams native CQL JSON encodings through paged SELECT JSON and prepared INSERT JSON IF NOT EXISTS. Each row is applied independently and confirmed without overwriting an existing primary key.', [
    ['cql-json-lines', 'Cassandra CQL JSON Lines', 'native', ['jsonl', 'ndjson'], 'One native CQL JSON object per line, preserving Cassandra JSON encodings.'],
  ]),
  influxdb: {
    actions: ['import', 'export'],
    formats: [['line-protocol', 'Line protocol', 'native', ['lp'], 'Lossless InfluxDB 1.x line protocol with native field types, tags, and nanosecond timestamps.']],
    support: 'live',
    description: 'InfluxDB 1.x streams measurements as native line protocol. Imports create a new database and roll it back if any bounded write batch fails.',
    multiple: false,
    requiresExistingTarget: false,
    options: {
      import: [{
        id: 'targetDatabase',
        label: 'New target database',
        input: 'text',
        required: true,
        placeholder: 'metrics_imported',
        description: 'Must not already exist. This prevents native point writes from overwriting a series and timestamp.',
      }],
    },
  },
  prometheus: {
    actions: ['import', 'export'],
    formats: [
      ['prometheus-json', 'Prometheus API JSON', 'native', ['json'], 'The complete native Prometheus HTTP API response envelope.'],
      ['openmetrics', 'OpenMetrics', 'native', ['prom'], 'OpenMetrics text with complete labels, sample values, and timestamps.'],
      portableCsv,
    ],
    support: 'live',
    supportByAction: { import: 'unsupported', export: 'live' },
    description: 'Prometheus exports bounded instant or range query results. Import is unavailable because remote write cannot atomically fail when an existing series and timestamp would be replaced.',
    multiple: true,
    requiresExistingTarget: false,
    disabledReasonByAction: {
      import: 'Prometheus remote write unconditionally replaces existing series/timestamps and cannot provide the required atomic fail-on-conflict guarantee.',
    },
    options: {
      export: [
        {
          id: 'query',
          label: 'PromQL query',
          input: 'text',
          required: true,
          placeholder: 'up{job="prometheus"}',
          description: 'A PromQL instant or range query. DataPad++ never writes the query into transfer metadata.',
        },
        {
          id: 'start',
          label: 'Range start',
          input: 'text',
          required: false,
          requiredWith: ['end', 'step'],
          placeholder: '2026-08-31T12:00:00Z',
          description: 'Optional RFC 3339 or Unix timestamp. Supply start, end, and step together for a range export.',
        },
        {
          id: 'end',
          label: 'Range end',
          input: 'text',
          required: false,
          requiredWith: ['start', 'step'],
          placeholder: '2026-08-31T13:00:00Z',
          description: 'Inclusive range end.',
        },
        {
          id: 'step',
          label: 'Range step',
          input: 'text',
          required: false,
          requiredWith: ['start', 'end'],
          placeholder: '15s',
          description: 'Prometheus query step, such as 15s or 1m.',
        },
      ],
    },
  },
  opentsdb: {
    actions: ['import', 'export'],
    formats: [['opentsdb-json', 'OpenTSDB query JSON', 'native', ['json'], 'The raw, non-aggregated OpenTSDB series response with exact tags, timestamps, and numeric values.']],
    support: 'live',
    supportByAction: { import: 'unsupported', export: 'live' },
    description: 'OpenTSDB exports raw series through /api/query with the native none aggregator. Import is unavailable because /api/put cannot atomically fail when a series and timestamp already exist.',
    disabledReasonByAction: {
      import: 'OpenTSDB /api/put can replace an existing series/timestamp and has no atomic create-only precondition.',
    },
    multiple: false,
    requiresExistingTarget: false,
    options: {
      export: [
        {
          id: 'metric',
          label: 'Metric',
          input: 'text',
          required: true,
          placeholder: 'sys.cpu.user',
          description: 'The exact OpenTSDB metric name. Explorer selections fill this automatically.',
        },
        {
          id: 'start',
          label: 'Range start',
          input: 'text',
          required: true,
          placeholder: '24h-ago',
          description: 'OpenTSDB absolute, relative, or Unix start time.',
        },
        {
          id: 'end',
          label: 'Range end',
          input: 'text',
          required: true,
          placeholder: 'now',
          description: 'OpenTSDB absolute, relative, or Unix end time.',
        },
      ],
    },
  },
  neo4j: liveData('Neo4j streams the complete graph through Bolt using typed JSON Lines and restores it transactionally into an empty database.', [['neo4j-json', 'Neo4j typed JSON Lines', 'native', ['jsonl'], 'DataPad++ Neo4j graph stream preserving labels, relationship types, binary, temporal, spatial, and scalar property values.']], undefined, false),
  arango: liveData('ArangoDB streams collection exports through paged AQL cursors and imports through the complete, duplicate-safe Import API. _key and edge endpoints are preserved; server-owned revisions are regenerated.', [portableJson, portableNdjson]),
  janusgraph: liveData('JanusGraph streams vertices and edges as GraphSON 3 with an explicit schema manifest, preserving identifiers, labels, property cardinality, meta-properties, and native values.', [['graphson3', 'GraphSON 3', 'native', ['graphson', 'jsonl'], 'GraphSON 3 graph stream with a JanusGraph schema compatibility manifest.']], undefined, false),
  dynamodb: liveData('DynamoDB Local and endpoint-override connections stream exact typed AttributeValue objects through paged Scan and conditional PutItem. Managed S3/Ion jobs remain cloud-gated.', [['dynamodb-json', 'DynamoDB JSON Lines', 'native', ['jsonl', 'ndjson'], 'One exact DynamoDB AttributeValue item per line.']], undefined, false),
  cosmosdb: liveData('Cosmos DB NoSQL streams lossless documents with explicit identity and hierarchical partition-routing metadata. Imports use create semantics and never replace an existing id/partition pair.', [['cosmos-json-lines', 'Cosmos DB JSON Lines', 'native', ['jsonl', 'ndjson'], 'One document envelope per line with partition-key paths, resolved routing values, and source concurrency metadata.']], undefined, false),
  snowflake: plannedData('Snowflake loads and unloads through named stages with COPY INTO.', [portableCsv, portableJson, ['parquet', 'Parquet', 'native', ['parquet'], 'Snowflake Parquet stage data.']], ['named-stage', 'cloud-uri']),
  bigquery: plannedData('BigQuery uses managed load and extract jobs through Cloud Storage.', [portableCsv, portableNdjson, ['avro', 'Avro', 'native', ['avro'], 'BigQuery Avro data.'], ['parquet', 'Parquet', 'native', ['parquet'], 'BigQuery Parquet data.']], ['cloud-uri']),
  neptune: plannedData('Neptune imports through its S3 bulk loader and exports bounded graph queries.', [['graphson', 'GraphSON', 'native', ['json'], 'Property graph GraphSON.'], ['rdf', 'RDF', 'native', ['ttl', 'nt', 'rdf'], 'RDF graph data.'], portableCsv], ['cloud-uri']),
  memcached: liveData('Memcached transfers only an explicitly selected key. The artifact contains the exact raw value bytes; flags and expiry are explicit protocol inputs.', [['raw', 'Raw value bytes', 'native', ['bin'], 'The exact bytes accepted by the Memcached storage command.']], undefined, false, {
    import: [
      {
        id: 'flags',
        label: 'Flags',
        input: 'integer',
        required: true,
        min: 0,
        max: 4_294_967_295,
        defaultValue: 0,
        description: 'The unsigned application flags stored with the value.',
      },
      {
        id: 'expirySeconds',
        label: 'Expiry in seconds',
        input: 'integer',
        required: true,
        min: 0,
        max: 2_592_000,
        placeholder: '0 keeps the value until eviction',
        description: 'Required because Memcached cannot report the original expiry. Use 0 for no expiry.',
      },
    ],
  }),
}

const NATIVE_BACKUP_ENGINES = new Set<DatastoreEngine>([
  'sqlite', 'duckdb', 'cockroachdb', 'sqlserver', 'oracle', 'elasticsearch', 'opensearch',
  'clickhouse', 'arango', 'dynamodb', 'cosmosdb', 'snowflake', 'bigquery', 'neptune',
])

const LIVE_BACKUP_ENGINES = new Set<DatastoreEngine>(['sqlite', 'duckdb', 'cockroachdb', 'sqlserver'])

function isLiveBackupAction(engine: DatastoreEngine, action: 'backup' | 'restore') {
  return engine === 'cockroachdb' || engine === 'sqlserver' || engine === 'duckdb'
    || (LIVE_BACKUP_ENGINES.has(engine) && action === 'backup')
}

export function datastoreTransferManifest(engine: DatastoreEngine): DatastoreTransferManifest {
  const data = DATA_SPECS[engine]
  const capabilities = data.actions.map((action) => capability(engine, action, data))
  const backupNative = NATIVE_BACKUP_ENGINES.has(engine)

  for (const action of ['backup', 'restore'] as const) {
    const live = isLiveBackupAction(engine, action)
    capabilities.push(capability(engine, action, {
      actions: [action],
      formats: backupFormats(engine),
      destinations: backupDestinations(engine),
      support: live ? 'live' : backupNative ? 'plan-only' : 'unsupported',
      operationIds: backupOperationIds(engine),
      description: backupNative
        ? nativeBackupDescription(engine)
        : 'This datastore has no supported in-process or server API for a full native backup artifact.',
      disabledReason: backupNative
        ? action === 'restore' && LIVE_BACKUP_ENGINES.has(engine) && !live
          ? `${engineLabel(engine)} restore remains validation-only until isolated-target restore checks are complete.`
          : live
            ? undefined
            : `${engineLabel(engine)} native ${action} execution is not implemented yet.`
        : `Full ${engineLabel(engine)} backup and restore require excluded vendor tooling or storage-backend access.`,
      multiple: true,
      requiresExistingTarget: false,
      options: backupOptions(engine, action),
    }))
  }

  return { engine, capabilities }
}

export function isDatastoreTransferOperation(operationId: string) {
  return /\.data\.(?:import-export|backup-restore)$/.test(operationId)
    || /^(?:sqlite\.table\.(?:import|export)|sqlite\.database\.backup|mongodb\.collection\.(?:import|export)|(?:redis|valkey)\.key\.(?:import|export)|cockroach\.(?:import|export|backup|restore))$/.test(operationId)
}

function liveData(
  description: string,
  formats: FormatSpec[],
  operationIds?: CapabilitySpec['operationIds'],
  multiple = true,
  options?: CapabilitySpec['options'],
): CapabilitySpec {
  return { actions: ['import', 'export'], formats, support: 'live', description, operationIds, multiple, options, requiresExistingTarget: true }
}

function plannedData(description: string, formats: FormatSpec[], destinations: DatastoreTransferDestinationKind[] = ['local-file'], multiple = true): CapabilitySpec {
  return { actions: ['import', 'export'], formats, destinations, support: 'plan-only', description, multiple, requiresExistingTarget: true, disabledReason: 'Native execution for this datastore is not implemented yet; review the generated plan without running it.' }
}

function liveSearchData(description: string): CapabilitySpec {
  return {
    actions: ['import', 'export'],
    formats: [[
      'search-transfer-folder',
      'Search transfer folder',
      'native',
      [],
      'Mappings, portable index settings, and native Bulk NDJSON data.',
    ]],
    destinations: ['local-folder'],
    support: 'live',
    description,
    multiple: false,
    requiresExistingTarget: false,
    options: {
      import: [{
        id: 'targetIndex',
        label: 'New target index',
        input: 'text',
        required: true,
        placeholder: 'products-restored',
        description: 'Must be a valid lowercase index name that does not already exist.',
      }],
    },
  }
}

function capability(engine: DatastoreEngine, action: DatastoreTransferAction, spec: CapabilitySpec): DatastoreTransferCapability {
  const kind = action === 'backup' || action === 'restore' ? 'backup' : 'data'
  return {
    action,
    kind,
    operationId: spec.operationIds?.[action] ?? `${engine}.data.${kind === 'data' ? 'import-export' : 'backup-restore'}`,
    scope: kind === 'backup' ? 'database' : dataScope(engine),
    executionSupport: spec.supportByAction?.[action] ?? spec.support ?? 'plan-only',
    formats: spec.formats.map(format),
    options: spec.options?.[action],
    destinationKinds: spec.destinations ?? ['local-file'],
    supportsMultipleObjects: spec.multiple ?? true,
    requiresExistingTarget: spec.requiresExistingTarget ?? true,
    description: spec.description,
    disabledReason: spec.disabledReasonByAction?.[action] ?? spec.disabledReason,
  }
}

function format([id, label, fidelity, extensions, description, warning]: FormatSpec): DatastoreTransferFormat {
  return { id, label, fidelity, extensions, description, warning }
}

function dataScope(engine: DatastoreEngine): DatastoreTransferCapability['scope'] {
  if (['mongodb', 'cosmosdb', 'litedb', 'arango'].includes(engine)) return 'collection'
  if (['redis', 'valkey', 'memcached'].includes(engine)) return 'key'
  if (['elasticsearch', 'opensearch'].includes(engine)) return 'index'
  if (['neo4j', 'neptune', 'janusgraph'].includes(engine)) return 'database'
  if (['influxdb', 'prometheus', 'opentsdb'].includes(engine)) return 'query'
  return 'table'
}

function backupOperationIds(engine: DatastoreEngine): CapabilitySpec['operationIds'] {
  if (engine === 'sqlite') return { backup: 'sqlite.database.backup' }
  return undefined
}

function backupOptions(
  engine: DatastoreEngine,
  action: 'backup' | 'restore',
): CapabilitySpec['options'] {
  if (!['cockroachdb', 'sqlserver', 'duckdb'].includes(engine) || action !== 'restore') return undefined
  if (engine === 'duckdb') {
    return {
      restore: [{
        id: 'targetDatabase',
        label: 'New database file',
        input: 'text',
        required: true,
        placeholder: 'C:\\data\\restored.duckdb',
        description: 'Enter an absolute path that does not exist. DuckDB restores into this new isolated database file.',
      }],
    }
  }
  return {
    restore: [{
      id: 'targetDatabase',
      label: 'New target database',
      input: 'text',
      required: true,
      placeholder: 'restored_database',
      description: `Must not already exist. ${engineLabel(engine)} restores the backup under this new database name.`,
    }],
  }
}

function backupFormats(engine: DatastoreEngine): FormatSpec[] {
  if (engine === 'sqlite') return [['sqlite', 'SQLite database', 'native', ['sqlite', 'sqlite3', 'db'], 'Complete SQLite database file.']]
  if (engine === 'duckdb') return [['parquet', 'DuckDB Parquet directory', 'native', [], 'DuckDB EXPORT DATABASE directory using Parquet.'], ['csv', 'DuckDB CSV directory', 'native', [], 'DuckDB EXPORT DATABASE directory using CSV.']]
  if (engine === 'sqlserver') return [['bak', 'SQL Server backup', 'native', ['bak'], 'Native SQL Server backup artifact.']]
  if (engine === 'oracle') return [['datapump', 'Oracle Data Pump', 'native', ['dmp'], 'Oracle Data Pump dump set.']]
  return [['native-backup', 'Native managed backup', 'native', [], 'Datastore-managed backup or snapshot.']]
}

function backupDestinations(engine: DatastoreEngine): DatastoreTransferDestinationKind[] {
  if (engine === 'sqlite') return ['local-file']
  if (engine === 'duckdb') return ['local-folder']
  if (engine === 'oracle') return ['server-path']
  if (engine === 'sqlserver') return ['server-path', 'cloud-uri']
  if (engine === 'elasticsearch' || engine === 'opensearch' || engine === 'arango') return ['repository']
  if (['dynamodb', 'cosmosdb', 'snowflake', 'bigquery', 'neptune'].includes(engine)) return ['managed-restore', 'cloud-uri']
  return ['cloud-uri', 'server-path']
}

function nativeBackupDescription(engine: DatastoreEngine) {
  const descriptions: Partial<Record<DatastoreEngine, string>> = {
    sqlite: 'SQLite creates a complete local database snapshot.',
    duckdb: 'DuckDB exports a complete database directory.',
    cockroachdb: 'CockroachDB uses managed BACKUP and RESTORE jobs.',
    oracle: 'Oracle uses DBMS_DATAPUMP for table and schema archives.',
    elasticsearch: 'Elasticsearch uses configured snapshot repositories.',
    opensearch: 'OpenSearch uses version-compatible snapshot repositories.',
    clickhouse: 'ClickHouse uses configured disks or object storage.',
    arango: 'ArangoDB Hot Backup is available when the server edition supports it.',
    dynamodb: 'DynamoDB uses managed backup and restore APIs.',
    cosmosdb: 'Cosmos DB exposes platform-managed restore operations.',
    snowflake: 'Snowflake uses zero-copy clone and Time Travel recovery.',
    bigquery: 'BigQuery uses table copies, snapshots, and clones.',
    neptune: 'Neptune uses managed cluster snapshots and restore.',
  }
  return descriptions[engine] ?? 'The datastore exposes a native managed backup workflow.'
}

function engineLabel(engine: DatastoreEngine) {
  const labels: Partial<Record<DatastoreEngine, string>> = {
    postgresql: 'PostgreSQL', cockroachdb: 'CockroachDB', sqlserver: 'SQL Server',
    mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', oracle: 'Oracle',
    mongodb: 'MongoDB', cosmosdb: 'Cosmos DB', litedb: 'LiteDB', dynamodb: 'DynamoDB',
    redis: 'Redis', valkey: 'Valkey', memcached: 'Memcached', neo4j: 'Neo4j',
    neptune: 'Neptune', arango: 'ArangoDB', janusgraph: 'JanusGraph', influxdb: 'InfluxDB',
    timescaledb: 'TimescaleDB', prometheus: 'Prometheus', opentsdb: 'OpenTSDB',
    elasticsearch: 'Elasticsearch', opensearch: 'OpenSearch', clickhouse: 'ClickHouse',
    duckdb: 'DuckDB', snowflake: 'Snowflake', bigquery: 'BigQuery', cassandra: 'Cassandra',
  }
  return labels[engine] ?? engine
}
