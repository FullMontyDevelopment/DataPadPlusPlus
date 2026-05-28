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
    case 'memcached':
      return memcachedTree()
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
    case 'cockroachdb':
      return cockroachTree()
    case 'postgresql':
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
      return influxTree()
    case 'opentsdb':
      return openTsdbTree()
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
      return liteDbTree()
    case 'cosmosdb':
      return cosmosTree()
    default:
      return family === 'timeseries' ? timeSeriesTree() : genericTree(family)
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

function memcachedTree(): DatastoreTreeNodeManifest[] {
  return [
    node('server', 'Server', 'server', 'Memcached cache server overview', {
      children: [
        node('stats', 'Stats', 'stats', 'Operational counters, hit rate, item count, and memory use'),
        node('slabs', 'Slabs', 'slabs', 'Slab classes, chunk sizes, pages, and allocation pressure'),
        node('items', 'Item Classes', 'items', 'Item-class counts, ages, evictions, and reclaim signals'),
        node('settings', 'Settings', 'settings', 'Cache limits, protocol flags, and LRU behavior'),
        node('connections', 'Connections', 'connections', 'Client connection pressure and rejected clients'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Hit ratio, evictions, memory pressure, and connection pressure'),
  ]
}

function liteDbTree(): DatastoreTreeNodeManifest[] {
  return [
    node('database', 'Local Database', 'database', 'LiteDB local database file', {
      children: [
        node('collections', 'Collections', 'collections', 'Document collections'),
        node('indexes', 'Indexes', 'indexes', 'Collection index definitions'),
        node('file-storage', 'File Storage', 'file-storage', 'LiteDB file storage metadata'),
        node('storage', 'Storage', 'storage', 'Page allocation and maintenance health'),
        node('settings', 'Settings', 'settings', 'Local file connection options'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'File health, index coverage, and storage warnings'),
  ]
}

function cosmosTree(): DatastoreTreeNodeManifest[] {
  return [
    node('account', 'Account', 'account', 'Cosmos DB account topology and API surface', {
      children: [
        node('databases', 'Databases', 'databases', 'Cosmos DB databases', {
          children: [
            node('selected-database', '{{database:catalog}}', 'database', 'Selected Cosmos DB database', {
              children: cosmosDatabaseChildren(),
              defaultDatabase: 'catalog',
            }),
          ],
        }),
        node('regions', 'Regions', 'regions', 'Read and write region topology'),
        node('consistency', 'Consistency', 'consistency', 'Default consistency and session behavior'),
        node('security', 'Security', 'security', 'RBAC, keys, networking, and access posture'),
        node('diagnostics', 'Diagnostics', 'diagnostics', 'RU, throttles, latency, and storage signals'),
      ],
    }),
  ]
}

function cosmosDatabaseChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('containers', 'Containers', 'containers', 'Cosmos DB containers', {
      children: [
        node('items', 'Items', 'items', 'Container item query surface'),
        node('partition-key', 'Partition Key', 'partition-key', 'Partition key path and routing hints'),
        node('indexing-policy', 'Indexing Policy', 'indexing-policy', 'Included, excluded, composite, and spatial paths'),
        node('throughput', 'Throughput', 'throughput', 'Manual, autoscale, or shared RU/s'),
        node('change-feed', 'Change Feed', 'change-feed', 'Change feed processor readiness'),
        node('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Server-side JavaScript stored procedures'),
        node('triggers', 'Triggers', 'triggers', 'Pre and post triggers'),
        node('udfs', 'User Defined Functions', 'udfs', 'Server-side JavaScript functions'),
        node('conflicts', 'Conflict Feed', 'conflicts', 'Multi-region conflict metadata'),
      ],
    }),
    node('throughput', 'Throughput', 'throughput', 'Shared database throughput where configured'),
    node('security', 'Security', 'security', 'Database-level access posture'),
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
    node('security', 'Security', 'security', 'Server logins, roles, and credentials'),
    node('server-objects', 'Server Objects', 'server-objects', 'Linked servers, endpoints, and server-level objects', {
      children: [
        node('linked-servers', 'Linked Servers', 'linked-servers', 'Remote server definitions and providers'),
        node('endpoints', 'Endpoints', 'endpoints', 'Database mirroring, service broker, and TDS endpoints'),
      ],
    }),
    node('replication', 'Replication', 'replication', 'Replication publications and subscriptions'),
    node('always-on', 'Always On High Availability', 'always-on-high-availability', 'Availability groups and replicas', {
      children: [
        node('availability-groups', 'Availability Groups', 'availability-groups', 'Always On availability groups and replicas'),
      ],
    }),
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
    node('performance', 'Performance', 'performance', 'Sessions, locks, waits, and tuning hints', {
      children: [
        node('sessions', 'Sessions', 'sessions', 'Active sessions and requests'),
        node('locks', 'Locks', 'locks', 'Locks and blocking chains'),
        node('waits', 'Wait Stats', 'waits', 'Wait categories and pressure'),
        node('missing-indexes', 'Missing Indexes', 'missing-indexes', 'Optimizer missing-index hints'),
      ],
    }),
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
    node('indexes', 'Indexes', 'indexes', 'Indexes and access paths'),
    node('functions', 'Functions', 'functions', 'Stored functions'),
    ...(engine === 'cockroachdb'
      ? []
      : [node('procedures', 'Procedures', 'procedures', 'Stored procedures')]),
    node('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    node('types', 'Types', 'types', 'Enum, composite, domain, and range types'),
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
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, locks, waits, statements, and relation health', {
      children: [
        node('sessions', 'Sessions', 'sessions', 'pg_stat_activity sessions'),
        node('locks', 'Locks', 'locks', 'pg_locks and blocking hints'),
        node('waits', 'Wait Events', 'waits', 'Wait event categories and pressure'),
        node('statements', 'Statement Stats', 'statements', 'pg_stat_statements summaries where available'),
        node('statistics', 'Relation Statistics', 'statistics', 'pg_stat relation and database stats'),
        node('index-health', 'Index Health', 'index-health', 'Index usage and maintenance signals'),
      ],
    }),
  ]
}

function cockroachTree(): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', 'CockroachDB database namespaces', {
      children: [
        node('selected-database', '{{database:defaultdb}}', 'database', 'Selected CockroachDB database', {
          children: [
            node('user-schemas', 'User Schemas', 'user-schemas', 'User-created object namespaces', {
              children: cockroachSchemaChildren(),
            }),
            node('system-schemas', 'System Schemas', 'system-schemas', 'crdb_internal, pg_catalog, information_schema, and system metadata'),
          ],
          defaultDatabase: 'defaultdb',
        }),
      ],
    }),
    node('cluster', 'Cluster', 'cluster', 'Nodes, ranges, regions, jobs, and cluster configuration', {
      children: [
        node('nodes', 'Nodes', 'nodes', 'Node liveness, locality, capacity, and range counts'),
        node('ranges', 'Ranges', 'ranges', 'Range distribution, replicas, and leaseholders'),
        node('regions', 'Regions / Localities', 'regions', 'Regional placement and locality tiers'),
        node('jobs', 'Jobs', 'jobs', 'Schema changes, backups, imports, restores, and changefeeds'),
        node('cluster-settings', 'Cluster Settings', 'cluster-settings', 'Runtime cluster settings and safety knobs'),
      ],
    }),
    node('security', 'Security', 'security', 'Roles, grants, default privileges, and certificates', {
      children: [
        node('roles', 'Roles', 'roles', 'Users, roles, memberships, and options'),
        node('grants', 'Grants', 'grants', 'Database, schema, table, sequence, and type privileges'),
        node('certificates', 'Certificates', 'certificates', 'Client and node certificate metadata where available'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, statement stats, transactions, contention, and range health', {
      children: [
        node('sessions', 'Sessions', 'sessions', 'Active SQL sessions and client metadata'),
        node('statements', 'Statement Stats', 'statements', 'Statement fingerprints, latency, rows, and retries'),
        node('transactions', 'Transactions', 'transactions', 'Transaction state, retry pressure, and contention hints'),
        node('contention', 'Contention', 'contention', 'Waiting keys and blocking transaction metadata'),
        node('locks', 'Locks', 'locks', 'Visible locks and waiters where available'),
        node('statistics', 'Statistics', 'statistics', 'Table, range, and database statistics'),
      ],
    }),
  ]
}

function cockroachSchemaChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'Base and regional tables'),
    node('views', 'Views', 'views', 'Stored query projections'),
    node('indexes', 'Indexes', 'indexes', 'Primary, secondary, partial, inverted, and vector indexes'),
    node('sequences', 'Sequences', 'sequences', 'Generated numeric sequences'),
    node('types', 'Types', 'types', 'Enum and user-defined types'),
    node('functions', 'Functions', 'functions', 'User-defined SQL functions'),
    node('zone-configurations', 'Zone Configurations', 'zone-configurations', 'Replication, constraints, lease preferences, and GC settings'),
  ]
}

function mysqlTree(): DatastoreTreeNodeManifest[] {
  return [
    node('databases', 'Databases', 'databases', 'MySQL/MariaDB schemas', {
      children: [
        node('selected-database', '{{database:default}}', 'database', 'Selected database', {
          children: [
            node('tables', 'Tables', 'tables', 'Base tables and storage engines'),
            node('views', 'Views', 'views', 'Stored SELECT definitions'),
            node('procedures', 'Stored Procedures', 'procedures', 'Stored procedure routines'),
            node('functions', 'Functions', 'functions', 'Stored functions'),
            node('events', 'Events', 'events', 'Scheduled event jobs'),
            node('triggers', 'Triggers', 'triggers', 'Database and table triggers'),
            node('indexes', 'Indexes', 'indexes', 'Schema-level index list'),
            node('storage', 'Storage', 'storage', 'Storage engines, table sizes, and fragmentation'),
          ],
        }),
      ],
    }),
    node('system-schemas', 'System Schemas', 'system-schemas', 'information_schema, performance_schema, mysql, and sys'),
    node('security', 'Users / Privileges', 'security', 'Users, roles, grants, authentication plugins, and privilege scope', {
      children: [
        node('users', 'Users', 'users', 'User accounts and authentication plugins'),
        node('roles', 'Roles', 'roles', 'Role assignments where supported'),
        node('permissions', 'Grants', 'permissions', 'Visible grants and privilege scopes'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Status, performance schema, and slow query metadata', {
      children: [
        node('sessions', 'Sessions', 'sessions', 'Processlist and active statements'),
        node('status-counters', 'Status Counters', 'statistics', 'Global status and table counters'),
        node('slow-queries', 'Slow Queries', 'slow-queries', 'Digest latency and slow-query signals'),
        node('innodb-status', 'InnoDB Status', 'innodb-status', 'Buffer pool, lock waits, and engine health'),
        node('replication', 'Replication', 'replication', 'Source/replica channel health'),
      ],
    }),
  ]
}

function oracleTree(): DatastoreTreeNodeManifest[] {
  return [
    node('selected-container', '{{database:ORCLPDB1}}', 'database', 'Selected Oracle service or PDB', {
      children: oracleSchemaChildren(),
      defaultDatabase: 'ORCLPDB1',
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
    node('performance', 'Performance', 'performance', 'Sessions, waits, SQL Monitor, and lock diagnostics'),
    node('scheduler', 'Scheduler', 'scheduler', 'Jobs, programs, chains, and windows', {
      optionalWhenLiveMetadata: true,
    }),
    node('queues', 'Queues', 'queues', 'Advanced Queuing objects', {
      optionalWhenLiveMetadata: true,
    }),
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
  if (engine === 'duckdb') {
    return [
      node('main-database', 'Main Database', 'database', 'DuckDB database file', {
        children: [
          node('schemas', 'Schemas', 'schemas', 'Attached schemas', {
            children: [
              node('main', 'main', 'schema', 'Main DuckDB schema', {
                children: [
                  node('tables', 'Tables', 'tables', 'Analytical tables'),
                  node('views', 'Views', 'views', 'Saved analytical projections'),
                  node('indexes', 'Indexes', 'indexes', 'Secondary indexes'),
                  node('functions', 'Functions & Macros', 'functions', 'Scalar/table functions and macros'),
                ],
              }),
              node('temp', 'temp', 'schema', 'Temporary schema'),
            ],
          }),
          node('attached-databases', 'Attached Databases', 'attached-databases', 'Attached DuckDB files'),
          node('extensions', 'Extensions', 'extensions', 'Installed and loadable extensions'),
          node('files', 'Files', 'files', 'Parquet, CSV, and JSON sources'),
          node('pragmas', 'Pragmas', 'pragmas', 'DuckDB settings and checks'),
          node('statistics', 'Statistics', 'statistics', 'Storage and column statistics'),
        ],
      }),
      node('diagnostics', 'Diagnostics', 'diagnostics', 'Memory, threads, storage, and query-risk metadata'),
    ]
  }

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
    node('diagnostics', 'Diagnostics', 'diagnostics', 'PRAGMA, explain, integrity, and storage metadata'),
  ]
}

function sqliteDatabaseChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'Base row-store tables'),
    node('views', 'Views', 'views', 'Stored SELECT definitions'),
    node('indexes', 'Indexes', 'indexes', 'Standalone and table indexes'),
    node('triggers', 'Triggers', 'triggers', 'Database and table triggers'),
    node('maintenance', 'Maintenance', 'maintenance', 'Integrity checks, analyze, optimize, vacuum, and backup workflows'),
  ]
}

function searchTree(): DatastoreTreeNodeManifest[] {
  return [
    node('cluster', 'Cluster', 'cluster', 'Cluster health and topology', {
      children: [
        node('health', 'Health', 'health', 'Cluster health and shard allocation'),
        node('nodes', 'Nodes', 'nodes', 'Node roles, heap, disk, CPU, and indexing/search load'),
        node('shard-allocation', 'Shard Allocation', 'shards', 'Shard routing and node placement'),
      ],
    }),
    node('indices', 'Indices', 'indices', 'Search indexes'),
    node('data-streams', 'Data Streams', 'data-streams', 'Append-oriented streams'),
    node('aliases', 'Aliases', 'aliases', 'Index aliases'),
    node('templates', 'Templates', 'templates', 'Index and component templates', {
      children: [
        node('index-templates', 'Index Templates', 'templates', 'Composable index templates'),
        node('component-templates', 'Component Templates', 'templates', 'Reusable template components'),
      ],
    }),
    node('pipelines', 'Pipelines', 'pipelines', 'Ingest pipelines'),
    node('security', 'Security', 'security', 'Roles, users, and index privileges', {
      children: [
        node('users', 'Users', 'users', 'Visible users and realms'),
        node('roles', 'Roles', 'roles', 'Cluster and index privileges'),
        node('api-keys', 'API Keys', 'api-keys', 'API keys and expiry state'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Shards, segments, tasks, snapshots, and lifecycle', {
      children: [
        node('shards', 'Shards', 'shards', 'Shard routing and state'),
        node('segments', 'Segments', 'segments', 'Lucene segment counts and deleted docs'),
        node('tasks', 'Tasks', 'tasks', 'Active task list'),
        node('snapshots', 'Snapshots', 'snapshots', 'Snapshot repositories and states'),
        node('lifecycle-policies', 'Lifecycle Policies', 'lifecycle-policies', 'ILM or ISM policy status'),
      ],
    }),
  ]
}

function dynamoDbTree(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'DynamoDB tables'),
    node('security', 'Access', 'security', 'IAM and table policies', {
      children: [
        node('permissions', 'Permissions', 'permissions', 'Visible table, stream, and index privileges'),
        node('policies', 'Table Policies', 'policies', 'Resource policies and disabled action reasons'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Consumed capacity, throttles, and costs', {
      children: [
        node('capacity', 'Capacity', 'capacity', 'Read/write usage, throttles, and latency'),
        node('hot-partitions', 'Hot Partitions', 'hot-partitions', 'High-traffic partition keys'),
        node('alarms', 'Alarms', 'alarms', 'Capacity, latency, and stream alarms'),
        node('backups', 'Backups', 'backups', 'PITR and on-demand backups'),
      ],
    }),
  ]
}

function cassandraTree(): DatastoreTreeNodeManifest[] {
  return [
    node('selected-keyspace', '{{database}}', 'keyspace', 'Selected Cassandra keyspace', {
      requiresDatabase: true,
      children: cassandraKeyspaceChildren(),
    }),
    node('keyspaces', 'Keyspaces', 'keyspaces', 'Cassandra keyspaces', {
      hiddenWhenDatabaseSelected: true,
    }),
    node('system-keyspaces', 'System Keyspaces', 'system-keyspaces', 'system_schema, system, and tracing metadata'),
    node('cluster', 'Cluster', 'cluster', 'Nodes, datacenters, token ownership, and replication', {
      children: [
        node('nodes', 'Nodes', 'nodes', 'Node status, datacenter, rack, and token ownership'),
        node('replication', 'Replication', 'statistics', 'Replication strategy and factor by keyspace'),
        node('repairs', 'Repairs', 'repairs', 'Repair and anti-entropy posture'),
      ],
    }),
    node('security', 'Security', 'security', 'Roles and permissions', {
      children: [
        node('roles', 'Roles', 'security', 'Role hierarchy and login state'),
        node('permissions', 'Permissions', 'permissions', 'Visible grants and resource permissions'),
      ],
    }),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Tracing, compaction, repair, and cluster status', {
      children: [
        node('tracing', 'Tracing', 'tracing', 'Trace sessions and latency detail'),
        node('compaction', 'Compaction', 'compaction', 'Pending compactions and compaction throughput'),
        node('statistics', 'Statistics', 'statistics', 'Read/write latency, tombstones, and dropped messages'),
        node('repairs', 'Repairs', 'repairs', 'Repair schedules and pending ranges'),
      ],
    }),
  ]
}

function cassandraKeyspaceChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('tables', 'Tables', 'tables', 'Partition-key-first tables'),
    node('materialized-views', 'Materialized Views', 'materialized-views', 'Derived query tables'),
    node('indexes', 'Indexes', 'indexes', 'SAI and secondary indexes'),
    node('types', 'Types', 'types', 'User-defined types'),
    node('functions', 'Functions', 'functions', 'User-defined functions'),
    node('aggregates', 'Aggregates', 'aggregates', 'User-defined aggregates'),
    node('permissions', 'Permissions', 'permissions', 'Visible grants for this keyspace'),
  ]
}

function prometheusTree(): DatastoreTreeNodeManifest[] {
  return [
    node('metrics', 'Metrics', 'metrics', 'Prometheus metric families'),
    node('labels', 'Labels', 'labels', 'Metric labels'),
    node('targets', 'Targets', 'targets', 'Scrape targets'),
    node('rules', 'Rules', 'rules', 'Recording and alerting rules'),
    node('alerts', 'Alerts', 'alerts', 'Alert states'),
    node('service-discovery', 'Service Discovery', 'service-discovery', 'Discovered and dropped targets'),
    node('tsdb', 'TSDB Status', 'tsdb', 'Head series, chunks, blocks, WAL, and retention'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'TSDB, runtime, and status metadata'),
  ]
}

function influxTree(): DatastoreTreeNodeManifest[] {
  return [
    node('selected-bucket', '{{database}}', 'bucket', 'Selected InfluxDB bucket', {
      requiresDatabase: true,
      children: influxBucketChildren(),
    }),
    node('buckets', 'Buckets', 'buckets', 'InfluxDB buckets and retention scopes', {
      hiddenWhenDatabaseSelected: true,
    }),
    node('tasks', 'Tasks', 'tasks', 'Scheduled Flux tasks'),
    node('security', 'Tokens', 'security', 'Authorizations and bucket scopes'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Cardinality, storage, and query health'),
  ]
}

function influxBucketChildren(): DatastoreTreeNodeManifest[] {
  return [
    node('measurements', 'Measurements', 'measurements', 'Measurement names'),
    node('tags', 'Tags', 'tags', 'Indexed dimensions'),
    node('fields', 'Fields', 'fields', 'Field values'),
    node('retention-policies', 'Retention Policies', 'retention-policies', 'Retention and shard groups'),
  ]
}

function openTsdbTree(): DatastoreTreeNodeManifest[] {
  return [
    node('metrics', 'Metrics', 'metrics', 'OpenTSDB metric names'),
    node('tags', 'Tags', 'tags', 'Tag keys and values'),
    node('aggregators', 'Aggregators', 'aggregators', 'Supported aggregation functions'),
    node('downsampling', 'Downsampling', 'downsampling', 'Downsample windows and fill policies'),
    node('uid-metadata', 'UID Metadata', 'uid-metadata', 'Metric and tag UID metadata'),
    node('trees', 'Trees', 'trees', 'OpenTSDB tree definitions'),
    node('stats', 'Stats', 'stats', 'Runtime stats'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Backend health and query metadata'),
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
  const rootLabel = engine === 'arango' ? 'Graphs' : 'Databases'
  const proceduresLabel = engine === 'neptune' ? 'Loader Jobs' : engine === 'arango' ? 'Services' : 'Procedures'

  return [
    node('graphs', rootLabel, 'graphs', `${engine} graph scopes`),
    node('node-labels', 'Node Labels', 'node-labels', 'Node categories'),
    node('relationship-types', 'Relationship Types', 'relationship-types', 'Edge categories'),
    node('property-keys', 'Property Keys', 'property-keys', 'Property definitions'),
    node('indexes', 'Indexes', 'indexes', 'Graph indexes'),
    node('constraints', 'Constraints', 'constraints', 'Graph constraints'),
    node('procedures', proceduresLabel, 'procedures', 'Procedures, services, algorithms, or loader jobs'),
    node('security', 'Security', 'security', 'Users, roles, and graph permissions'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Explain/profile and backend health'),
  ]
}

function bigQueryTree(): DatastoreTreeNodeManifest[] {
  return [
    node('datasets', 'Datasets', 'datasets', 'BigQuery datasets'),
    node('tables', 'Tables', 'tables', 'Partitioned and clustered tables'),
    node('views', 'Views', 'views', 'Views'),
    node('materialized-views', 'Materialized Views', 'materialized-views', 'Materialized views'),
    node('stages', 'External Tables', 'stages', 'External tables and object sources'),
    node('warehouses', 'Reservations', 'warehouses', 'Slots, reservations, and assignments'),
    node('jobs', 'Jobs', 'jobs', 'Query and load jobs'),
    node('security', 'Security', 'security', 'IAM and dataset access'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Slots, bytes, jobs, and cost metadata'),
  ]
}

function warehouseTree(engine: DatastoreEngine): DatastoreTreeNodeManifest[] {
  const namespaceLabel = engine === 'clickhouse' ? 'Databases' : 'Databases'
  const computeLabel = engine === 'clickhouse' ? 'Clusters' : 'Warehouses'
  const jobsLabel = engine === 'snowflake' ? 'Tasks & Query History' : 'Jobs'
  const stageLabel = engine === 'clickhouse' ? 'External Tables' : 'Stages'

  return [
    node('databases', namespaceLabel, 'databases', `${engine} databases`),
    node('tables', 'Tables', 'tables', 'Tables'),
    node('views', 'Views', 'views', 'Views'),
    node('materialized-views', 'Materialized Views', 'materialized-views', 'Materialized views'),
    node('stages', stageLabel, 'stages', 'Internal and external stages'),
    node('warehouses', computeLabel, 'warehouses', 'Compute warehouses'),
    node('jobs', jobsLabel, 'jobs', 'Query history, jobs, and scheduled work'),
    node('security', 'Security', 'security', 'Roles and grants'),
    node('diagnostics', 'Diagnostics', 'diagnostics', 'Query history, cost, and utilization'),
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
