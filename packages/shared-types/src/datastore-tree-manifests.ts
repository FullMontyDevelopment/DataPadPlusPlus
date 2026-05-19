import type { DatastoreEngine, DatastoreFamily } from './connection'
import type { DatastoreTreeManifest, DatastoreTreeNodeManifest } from './capabilities'

export function datastoreTreeForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTreeManifest {
  return {
    version: 1,
    emptyState: 'structural-folders',
    roots: rootsForEngine(engine, family),
  }
}

function rootsForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTreeNodeManifest[] {
  switch (engine) {
    case 'mongodb':
      return mongoTree()
    case 'redis':
    case 'valkey':
      return redisTree()
    case 'sqlserver':
      return sqlServerTree()
    case 'sqlite':
      return sqliteTree()
    case 'duckdb':
      return embeddedSqlTree(engine)
    case 'mysql':
    case 'mariadb':
      return mysqlTree()
    case 'oracle':
      return oracleTree()
    case 'postgresql':
    case 'cockroachdb':
    case 'timescaledb':
      return postgresFamilyTree(engine)
    case 'elasticsearch':
    case 'opensearch':
      return searchTree()
    case 'dynamodb':
      return dynamoDbTree()
    case 'cassandra':
      return cassandraTree()
    case 'prometheus':
      return prometheusTree()
    case 'influxdb':
    case 'opentsdb':
      return timeSeriesTree()
    case 'neo4j':
    case 'neptune':
    case 'arango':
    case 'janusgraph':
      return graphTree(engine)
    case 'bigquery':
      return bigQueryTree()
    case 'snowflake':
    case 'clickhouse':
      return warehouseTree(engine)
    case 'litedb':
    case 'cosmosdb':
      return documentTree(engine)
    default:
      return genericTree(family)
  }
}

function mongoTree(): DatastoreTreeNodeManifest[] {
  return [
    node('selected-database', '{{database}}', 'database', 'Selected MongoDB database', {
      requiresDatabase: true,
      children: mongoDatabaseChildren(),
    }),
    node('databases', 'Databases', 'databases', 'User MongoDB database namespaces', {
      hiddenWhenDatabaseSelected: true,
    }),
    node('system-databases', 'System Databases', 'system-databases', 'admin, config, local', {
      hiddenWhenDatabaseSelected: true,
    }),
  ]
}

function mongoDatabaseChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('collections', 'Collections', 'collections', 'Document collections'),
    node('views', 'Views', 'views', 'Read-only collection views'),
    node('time-series-collections', 'Time Series Collections', 'time-series-collections', 'Time-series optimized collections', {
      optionalWhenLiveMetadata: true,
    }),
    node('capped-collections', 'Capped Collections', 'capped-collections', 'Fixed-size collections', {
      optionalWhenLiveMetadata: true,
    }),
    node('gridfs', 'GridFS', 'gridfs', 'GridFS file buckets'),
    node('search-indexes', 'Search Indexes', 'search-indexes', 'Atlas Search indexes', {
      optionalWhenLiveMetadata: true,
    }),
    node('vector-indexes', 'Vector Indexes', 'vector-indexes', 'Vector search indexes', {
      optionalWhenLiveMetadata: true,
    }),
    node('users', 'Users', 'users', 'Database users'),
    node('roles', 'Roles', 'roles', 'Database roles'),
    node('database-statistics', 'Database Statistics', 'database-statistics', 'Database storage and activity statistics'),
  ]
}

function redisTree(): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', 'Logical Redis databases', {
      children: [
        node('db', 'DB {{database:0}}', 'database', 'Redis logical database', {
          children: [
            node('keys', 'Keys', 'keys', 'All key types'),
            node('strings', 'Strings', 'strings', 'String, bitmap, and HyperLogLog values'),
            node('hashes', 'Hashes', 'hashes', 'Hash maps'),
            node('lists', 'Lists', 'lists', 'Ordered list values'),
            node('sets', 'Sets', 'sets', 'Set values'),
            node('sorted-sets', 'Sorted Sets', 'sorted-sets', 'Scored set values'),
            node('streams', 'Streams', 'streams', 'Append-only stream values'),
            node('json', 'JSON', 'json', 'RedisJSON documents', {
              optionalWhenLiveMetadata: true,
            }),
            node('time-series', 'Time Series', 'time-series', 'RedisTimeSeries keys', {
              optionalWhenLiveMetadata: true,
            }),
            node('bloom-filters', 'Bloom Filters', 'bloom', 'RedisBloom filters', {
              optionalWhenLiveMetadata: true,
            }),
            node('search-indexes', 'Search Indexes', 'search-indexes', 'RediSearch indexes', {
              optionalWhenLiveMetadata: true,
            }),
            node('vector-indexes', 'Vector Indexes', 'vector-indexes', 'Vector search structures', {
              optionalWhenLiveMetadata: true,
            }),
            node('pubsub', 'Pub/Sub', 'pubsub', 'Channels, patterns, and subscribers', {
              optionalWhenLiveMetadata: true,
            }),
          ],
        }),
      ],
    }),
    node('cluster', 'Cluster', 'cluster', 'Cluster slots, nodes, and failover status', {
      optionalWhenLiveMetadata: true,
    }),
    node('sentinel', 'Sentinel', 'sentinel', 'Sentinel masters, replicas, and failover status', {
      optionalWhenLiveMetadata: true,
    }),
    node('lua-scripts', 'Lua Scripts', 'lua-scripts', 'Loaded scripts and SHA views'),
    node('functions', 'Functions', 'functions', 'Redis functions and libraries', {
      optionalWhenLiveMetadata: true,
    }),
    node('security', 'ACL / Security', 'security', 'ACL users, categories, and permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'INFO, SLOWLOG, memory, and latency metadata'),
  ]
}

function sqlServerTree(): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', 'SQL Server database catalogs', {
      children: [
        node('system-databases', 'System Databases', 'system-databases', 'Engine-maintained databases'),
        node('database-snapshots', 'Database Snapshots', 'database-snapshots', 'Point-in-time snapshots'),
        node('selected-database', '{{database:master}}', 'database', 'Selected database', {
          children: sqlServerDatabaseChildren(),
        }),
      ],
    }),
    node('linked-servers', 'Linked Servers', 'linked-servers', 'Remote server definitions and providers'),
    node('availability-groups', 'Availability Groups', 'availability-groups', 'Always On availability groups and replicas'),
    node('security', 'Security', 'security', 'Server logins, roles, and credentials'),
    node('server-objects', 'Server Objects', 'server-objects', 'Linked servers and endpoints'),
    node('replication', 'Replication', 'replication', 'Replication publications and subscriptions'),
    node('always-on', 'Always On High Availability', 'always-on-high-availability', 'Availability groups and replicas'),
    node('management', 'Management', 'management', 'Maintenance, policies, and data collection'),
    node('sql-agent', 'SQL Server Agent', 'sql-server-agent', 'Jobs, alerts, and operators'),
    node('extended-events', 'Extended Events', 'extended-events', 'Extended Events sessions and traces'),
    node('xevent-profiler', 'XEvent Profiler', 'xevent-profiler', 'Quick Extended Events profiling sessions'),
    node('ssis-catalogs', 'Integration Services Catalogs', 'integration-services-catalogs', 'SSIS catalogs', {
      optionalWhenLiveMetadata: true,
    }),
    node('analysis-services', 'Analysis Services', 'analysis-services', 'SSAS endpoints and model metadata where available', {
      optionalWhenLiveMetadata: true,
    }),
    node('reporting-services', 'Reporting Services', 'reporting-services', 'SSRS catalog metadata where available', {
      optionalWhenLiveMetadata: true,
    }),
  ]
}

function sqlServerDatabaseChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('database-diagrams', 'Database Diagrams', 'database-diagrams', 'Database relationship diagrams'),
    node('tables', 'Tables', 'tables', 'Base tables and table-like relations', {
      children: [
        node('system-tables', 'System Tables', 'system-tables', 'Engine-maintained tables'),
        node('filetables', 'FileTables', 'filetables', 'File-backed SQL Server tables'),
        node('external-tables', 'External Tables', 'external-tables', 'External data tables'),
        node('graph-tables', 'Graph Tables', 'graph-tables', 'SQL graph node and edge tables'),
        node('node-tables', 'Node Tables', 'node-tables', 'SQL graph node tables'),
        node('edge-tables', 'Edge Tables', 'edge-tables', 'SQL graph edge tables'),
      ],
    }),
    node('views', 'Views', 'views', 'Stored query projections'),
    node('stored-procedures', 'Stored Procedures', 'stored-procedures', 'T-SQL and CLR procedures'),
    node('functions', 'Functions', 'functions', 'Scalar, table-valued, and CLR functions', {
      children: [
        node('scalar-functions', 'Scalar-valued Functions', 'scalar-functions', 'Scalar T-SQL functions'),
        node('table-valued-functions', 'Table-valued Functions', 'table-valued-functions', 'Inline and multi-statement table functions'),
        node('aggregate-functions', 'Aggregate Functions', 'aggregate-functions', 'CLR aggregate functions'),
        node('clr-functions', 'CLR Functions', 'clr-functions', 'CLR-backed functions'),
      ],
    }),
    node('synonyms', 'Synonyms', 'synonyms', 'Object aliases'),
    node('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    node('types', 'Types', 'types', 'User-defined and table types'),
    node('xml-schemas', 'XML Schemas', 'xml-schemas', 'XML schema collections'),
    node('assemblies', 'Assemblies', 'assemblies', 'CLR assemblies'),
    node('full-text-search', 'Full-Text Search', 'full-text-search', 'Full-text catalogs and indexes'),
    node('service-broker', 'Service Broker', 'service-broker', 'Messaging, queues, services, and routes'),
    node('security', 'Security', 'security', 'Database security metadata', {
      children: [
        node('users', 'Users', 'users', 'Database users'),
        node('roles', 'Roles', 'roles', 'Database roles'),
        node('schemas', 'Schemas', 'schemas', 'Database object namespaces'),
        node('certificates', 'Certificates', 'certificates', 'Database certificates'),
        node('symmetric-keys', 'Symmetric Keys', 'symmetric-keys', 'Database symmetric keys'),
        node('asymmetric-keys', 'Asymmetric Keys', 'asymmetric-keys', 'Database asymmetric keys'),
        node('credentials', 'Credentials', 'credentials', 'Database scoped credentials'),
        node('audits', 'Audits', 'audits', 'Database audit specifications'),
      ],
    }),
    node('query-store', 'Query Store', 'query-store', 'Runtime stats, plans, and regressed queries'),
    node('extended-events', 'Extended Events', 'extended-events', 'Database-scoped Extended Events sessions'),
    node('agent', 'Agent', 'sql-server-agent', 'Jobs, schedules, alerts, operators, and proxies', {
      children: [
        node('jobs', 'Jobs', 'jobs', 'Agent jobs'),
        node('schedules', 'Schedules', 'schedules', 'Agent schedules'),
        node('alerts', 'Alerts', 'alerts', 'Agent alerts'),
        node('operators', 'Operators', 'operators', 'Agent operators'),
        node('proxies', 'Proxies', 'proxies', 'Agent proxies'),
      ],
    }),
    node('replication', 'Replication', 'replication', 'Publications, subscriptions, and replication metadata'),
    node('cdc', 'CDC', 'cdc', 'Change Data Capture objects'),
    node('change-tracking', 'Change Tracking', 'change-tracking', 'Change tracking tables and settings'),
    node('external-resources', 'External Resources', 'external-resources', 'External data sources, file formats, and tables'),
    node('storage', 'Storage', 'storage', 'Files, filegroups, and partitions', {
      children: [
        node('filegroups', 'Filegroups', 'filegroups', 'Database filegroups'),
        node('files', 'Files', 'files', 'Database files'),
        node('partition-schemes', 'Partition Schemes', 'partition-schemes', 'Partition schemes'),
        node('partition-functions', 'Partition Functions', 'partition-functions', 'Partition functions'),
      ],
    }),
  ]
}

function postgresFamilyTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  const userChildren = [
    node('tables', 'Tables', 'tables', 'Base tables'),
    node('views', 'Views', 'views', 'Views'),
    node('materialized-views', 'Materialized Views', 'materialized-views', 'Persisted query projections'),
    sqlProgrammabilityNode(engine !== 'cockroachdb'),
    node('indexes', 'Indexes', 'indexes', 'Indexes and access paths'),
    node('extensions', 'Extensions', 'extensions', 'Installed extensions'),
    node('security', 'Security', 'security', 'Roles, grants, and privileges'),
  ]

  if (engine === 'timescaledb') {
    userChildren.splice(1, 0, node('hypertables', 'Hypertables', 'hypertables', 'Timescale hypertables'))
  }

  return [
    node('user-schemas', 'User Schemas', 'user-schemas', 'User-created schemas', {
      children: userChildren,
    }),
    node('system-schemas', 'System Schemas', 'system-schemas', 'pg_catalog, information_schema, and extension internals'),
    node('security', 'Security', 'security', 'Roles and permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, locks, stats, and health metadata'),
  ]
}

function mysqlTree(): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', 'MySQL/MariaDB schemas', {
      children: [
        node('selected-database', '{{database:default}}', 'database', 'Selected database', {
          children: [
            node('tables', 'Tables', 'tables', 'Base tables'),
            node('views', 'Views', 'views', 'Views'),
            sqlProgrammabilityNode(true),
            node('indexes', 'Indexes', 'indexes', 'Indexes and foreign keys'),
            node('security', 'Security', 'security', 'Users, host grants, and roles'),
          ],
        }),
      ],
    }),
    node('system-schemas', 'System Schemas', 'system-schemas', 'information_schema, performance_schema, mysql, and sys'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Status, performance schema, and slow query metadata'),
  ]
}

function oracleTree(): DatastoreTreeNodeManifest[] {
  return [
    node('containers', 'Containers', 'containers', 'Oracle CDB/PDB containers', {
      children: [
        node('selected-container', '{{database:ORCLPDB1}}', 'database', 'Selected Oracle container or service', {
          children: oracleSchemaChildren(),
          defaultDatabase: 'ORCLPDB1',
        }),
      ],
    }),
    node('schemas', 'Schemas', 'schemas', 'Oracle users and object schemas', {
      children: oracleSchemaChildren(),
    }),
    node('security', 'Security', 'security', 'Users, roles, profiles, privileges, and grants', {
      children: [
        node('users', 'Users', 'users', 'Database users'),
        node('roles', 'Roles', 'roles', 'Database roles'),
        node('profiles', 'Profiles', 'profiles', 'Password and resource profiles'),
        node('privileges', 'Privileges', 'System and object privileges'),
      ],
    }),
    node('storage', 'Storage', 'storage', 'Tablespaces, data files, segments, and quotas'),
    node('performance', 'Performance', 'performance', 'Sessions, waits, SQL Monitor, AWR, and ASH'),
    node('scheduler', 'Scheduler', 'scheduler', 'Jobs, programs, chains, and windows'),
    node('queues', 'Queues', 'queues', 'Advanced Queuing objects'),
    node('replication', 'Replication', 'replication', 'Replication and GoldenGate metadata', {
      optionalWhenLiveMetadata: true,
    }),
    node('data-guard', 'Data Guard', 'data-guard', 'Standby and protection status where available', {
      optionalWhenLiveMetadata: true,
    }),
    node('rac', 'RAC', 'rac', 'Cluster instances and services where available', {
      optionalWhenLiveMetadata: true,
    }),
    node('flashback', 'Flashback', 'flashback', 'Restore points and flashback metadata', {
      optionalWhenLiveMetadata: true,
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Plans, sessions, locks, waits, and database health'),
  ]
}

function oracleSchemaChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'Base tables', {
      children: [
        node('columns', 'Columns', 'columns', 'Column definitions'),
        node('indexes', 'Indexes', 'indexes', 'Indexes and access paths'),
        node('constraints', 'Constraints', 'constraints', 'Primary, foreign, unique, and check constraints'),
        node('triggers', 'Triggers', 'triggers', 'Table triggers'),
        node('partitions', 'Partitions', 'partitions', 'Partition and subpartition metadata'),
        node('statistics', 'Statistics', 'statistics', 'Optimizer statistics'),
        node('permissions', 'Permissions', 'permissions', 'Object grants and privileges'),
        node('ddl', 'DDL', 'ddl', 'Generated object DDL'),
      ],
    }),
    node('views', 'Views', 'views', 'Stored query projections'),
    node('materialized-views', 'Materialized Views', 'materialized-views', 'Refreshable persisted query results'),
    node('synonyms', 'Synonyms', 'synonyms', 'Object aliases'),
    node('sequences', 'Sequences', 'sequences', 'Generated numeric sequences'),
    node('functions', 'Functions', 'functions', 'PL/SQL functions'),
    node('procedures', 'Procedures', 'procedures', 'PL/SQL procedures'),
    node('packages', 'Packages', 'packages', 'PL/SQL package specs and bodies', {
      children: [
        node('package-spec', 'Spec', 'package-spec', 'Package specification'),
        node('package-body', 'Body', 'package-body', 'Package body'),
        node('dependencies', 'Dependencies', 'dependencies', 'Dependent and referenced objects'),
        node('compilation-errors', 'Compilation Errors', 'compilation-errors', 'Package compile errors'),
        node('permissions', 'Permissions', 'permissions', 'Package grants'),
      ],
    }),
    node('types', 'Types', 'types', 'Object, collection, and user-defined types'),
    node('java-sources', 'Java Sources', 'java-sources', 'Java stored source objects', {
      optionalWhenLiveMetadata: true,
    }),
    node('json-collections', 'JSON Collections', 'json-collections', 'Oracle JSON collection-style objects', {
      optionalWhenLiveMetadata: true,
    }),
    node('xml-db', 'XML DB', 'xml-db', 'XML DB resources and metadata', {
      optionalWhenLiveMetadata: true,
    }),
    node('external-tables', 'External Tables', 'external-tables', 'External file-backed tables', {
      optionalWhenLiveMetadata: true,
    }),
    node('database-links', 'Database Links', 'database-links', 'Remote database links', {
      optionalWhenLiveMetadata: true,
    }),
  ]
}

function embeddedSqlTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  return [
    node('schemas', 'Schemas', 'schemas', `${engine} attached schemas`, {
      children: [
        node('main', 'main', 'schema', 'Main database schema', {
          children: [
            node('tables', 'Tables', 'tables', 'Base tables'),
            node('views', 'Views', 'views', 'Views'),
            node('indexes', 'Indexes', 'indexes', 'Indexes'),
            node('triggers', 'Triggers', 'triggers', 'Triggers'),
          ],
        }),
        node('temp', 'temp', 'schema', 'Temporary schema'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'PRAGMA, explain, integrity, and storage metadata'),
  ]
}

function sqliteTree(): DatastoreTreeNodeManifest[] {
  return [
    node('main-database', 'Main Database', 'database', 'SQLite main database file', {
      children: sqliteDatabaseChildren(),
    }),
    node('attached-databases', 'Attached Databases', 'attached-databases', 'Database files attached to this connection'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'PRAGMA, explain, integrity, and storage metadata'),
  ]
}

function sqliteDatabaseChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'Base row-store tables'),
    node('views', 'Views', 'views', 'Stored SELECT definitions'),
    node('indexes', 'Indexes', 'indexes', 'Standalone and table indexes'),
    node('triggers', 'Triggers', 'triggers', 'Database and table triggers'),
    node('virtual-tables', 'Virtual Tables', 'virtual-tables', 'Extension-backed virtual tables', {
      optionalWhenLiveMetadata: true,
    }),
    node('fts-tables', 'FTS Tables', 'fts-tables', 'Full-text search virtual tables', {
      optionalWhenLiveMetadata: true,
    }),
    node('rtree-tables', 'RTree Tables', 'rtree-tables', 'Spatial RTree virtual tables', {
      optionalWhenLiveMetadata: true,
    }),
    node('generated-columns', 'Generated Columns', 'generated-columns', 'Generated and hidden columns', {
      optionalWhenLiveMetadata: true,
    }),
    node('attached-databases', 'Attached Databases', 'attached-databases', 'Other database files visible to this connection'),
    node('pragmas', 'Pragmas', 'pragmas', 'SQLite PRAGMA configuration and checks'),
    node('schema', 'Schema', 'schema', 'sqlite_schema definitions'),
  ]
}

function sqlProgrammabilityNode(includeStoredProcedures: boolean): DatastoreTreeNodeManifest {
  return node('programmability', 'Programmability', 'programmability', 'Procedures, functions, triggers, and types', {
    children: [
      ...(includeStoredProcedures
        ? [node('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable stored routines')]
        : []),
      node('functions', 'Functions', 'functions', 'Scalar and table-valued functions'),
      node('triggers', 'Triggers', 'triggers', 'Triggers'),
      node('sequences', 'Sequences', 'sequences', 'Generated numeric sequences'),
      node('types', 'Types', 'types', 'User-defined types'),
      node('synonyms', 'Synonyms', 'synonyms', 'Object aliases'),
    ],
  })
}

function searchTree(): DatastoreTreeNodeManifest[] {
  return [
    node('cluster', 'Cluster', 'cluster', 'Cluster health and topology'),
    node('indices', 'Indices', 'indices', 'Search indexes'),
    node('data-streams', 'Data Streams', 'data-streams', 'Append-oriented streams'),
    node('aliases', 'Aliases', 'aliases', 'Index aliases'),
    node('mappings', 'Mappings', 'mappings', 'Mappings and analyzers'),
    node('templates', 'Templates', 'templates', 'Index and component templates'),
    node('pipelines', 'Pipelines', 'pipelines', 'Ingest pipelines'),
    node('security', 'Security', 'security', 'Roles, users, and index privileges'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Shards, segments, cat APIs, and profile data'),
  ]
}

function dynamoDbTree(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'DynamoDB tables', {
      children: [
        node('items', 'Items', 'items', 'Table items'),
        node('global-secondary-indexes', 'Global Secondary Indexes', 'indexes', 'GSIs'),
        node('local-secondary-indexes', 'Local Secondary Indexes', 'indexes', 'LSIs'),
        node('streams', 'Streams', 'streams', 'DynamoDB Streams'),
        node('ttl', 'TTL', 'ttl', 'Time-to-live settings'),
      ],
    }),
    node('security', 'Security', 'security', 'IAM and table policies'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Consumed capacity, throttles, and costs'),
  ]
}

function cassandraTree(): DatastoreTreeNodeManifest[] {
  return [
    node('keyspaces', 'Keyspaces', 'keyspaces', 'Cassandra keyspaces', {
      children: [
        node('tables', 'Tables', 'tables', 'Partition-key tables'),
        node('materialized-views', 'Materialized Views', 'materialized-views', 'Materialized views'),
        node('indexes', 'Indexes', 'indexes', 'Secondary indexes and SAI'),
        node('types', 'Types', 'types', 'User-defined types'),
      ],
    }),
    node('security', 'Security', 'security', 'Roles and permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Tracing, compaction, repair, and cluster status'),
  ]
}

function prometheusTree(): DatastoreTreeNodeManifest[] {
  return [
    node('metrics', 'Metrics', 'metrics', 'Prometheus metric families'),
    node('labels', 'Labels', 'labels', 'Metric labels'),
    node('targets', 'Targets', 'targets', 'Scrape targets'),
    node('rules', 'Rules', 'rules', 'Recording and alerting rules'),
    node('alerts', 'Alerts', 'alerts', 'Alert states'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'TSDB, runtime, and status metadata'),
  ]
}

function timeSeriesTree(): DatastoreTreeNodeManifest[] {
  return [
    node('buckets', 'Buckets', 'buckets', 'Time-series storage scopes', {
      children: [
        node('measurements', 'Measurements', 'measurements', 'Measurement names'),
        node('tags', 'Tags', 'tags', 'Indexed dimensions'),
        node('fields', 'Fields', 'fields', 'Field values'),
        node('retention-policies', 'Retention Policies', 'retention-policies', 'Retention rules'),
        node('tasks', 'Tasks', 'tasks', 'Scheduled processing tasks'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Cardinality, storage, and query metadata'),
  ]
}

function graphTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  return [
    node('graphs', 'Graphs', 'graphs', `${engine} graph scopes`, {
      children: [
        node('node-labels', 'Node Labels', 'node-labels', 'Node categories'),
        node('relationship-types', 'Relationship Types', 'relationship-types', 'Edge categories'),
        node('indexes', 'Indexes', 'indexes', 'Graph indexes'),
        node('constraints', 'Constraints', 'constraints', 'Graph constraints'),
        node('property-keys', 'Property Keys', 'property-keys', 'Property definitions'),
      ],
    }),
    node('security', 'Security', 'security', 'Users, roles, and graph permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Explain/profile and backend health'),
  ]
}

function bigQueryTree(): DatastoreTreeNodeManifest[] {
  return [
    node('projects', 'Projects', 'projects', 'Google Cloud projects', {
      children: [
        node('datasets', 'Datasets', 'datasets', 'BigQuery datasets', {
          children: [
            node('tables', 'Tables', 'tables', 'Tables'),
            node('views', 'Views', 'views', 'Views'),
            node('routines', 'Routines', 'functions', 'Routines and functions'),
            node('jobs', 'Jobs', 'jobs', 'Query and load jobs'),
          ],
        }),
      ],
    }),
    node('security', 'Security', 'security', 'IAM and dataset access'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Slots, bytes, jobs, and cost metadata'),
  ]
}

function warehouseTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', `${engine} databases`, {
      children: [
        node('schemas', 'Schemas', 'schemas', 'Schemas', {
          children: [
            node('tables', 'Tables', 'tables', 'Tables'),
            node('views', 'Views', 'views', 'Views'),
            node('materialized-views', 'Materialized Views', 'materialized-views', 'Materialized views'),
            node('stages', 'Stages', 'stages', 'Internal and external stages'),
            node('tasks', 'Tasks', 'tasks', 'Tasks and scheduled work'),
          ],
        }),
      ],
    }),
    node('warehouses', 'Warehouses', 'warehouses', 'Compute warehouses'),
    node('security', 'Security', 'security', 'Roles and grants'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Query history, cost, and utilization'),
  ]
}

function documentTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', `${engine} document databases`, {
      children: [
        node('collections', 'Collections', 'collections', 'Document collections'),
        node('views', 'Views', 'views', 'Views where supported'),
        node('indexes', 'Indexes', 'indexes', 'Index definitions'),
      ],
    }),
    node('security', 'Security', 'security', 'Users, roles, and permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Collection and server diagnostics'),
  ]
}

function genericTree(family: DatastoreFamily): DatastoreTreeNodeManifest[] {
  return [
    node('objects', 'Objects', `${family}-objects`, `${family} adapter objects`),
    node('security', 'Security', 'security', 'Roles, users, and permissions where supported'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Health and performance metadata where supported'),
  ]
}

function node(
  id: string,
  label: string,
  kind: string,
  detail?: string,
  options: Partial<DatastoreTreeNodeManifest> = {},
): DatastoreTreeNodeManifest {
  return { id, label, kind, detail, ...options }
}
