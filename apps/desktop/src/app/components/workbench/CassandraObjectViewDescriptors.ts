export interface CassandraObjectViewDescriptor {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const CASSANDRA_OBJECT_VIEW_DESCRIPTORS: Record<string, CassandraObjectViewDescriptor> = {
  keyspace: descriptor(
    'keyspace',
    'Open Keyspace',
    'Cassandra Keyspace',
    'Review tables, materialized views, indexes, replication, and permissions for this keyspace.',
    'No keyspace metadata is loaded',
    'Refresh this keyspace to collect schema and replication metadata.',
  ),
  tables: descriptor(
    'tables',
    'Open Tables',
    'Cassandra Tables',
    'Review partition-key-first tables and open scoped CQL query builders.',
    'No tables were returned',
    'Refresh this keyspace or check permissions on system_schema.tables.',
  ),
  table: descriptor(
    'table',
    'Open Table',
    'Cassandra Table',
    'Inspect partition keys, clustering columns, storage options, indexes, and safe row-query workflows.',
    'No table metadata is loaded',
    'Refresh this table to collect CQL schema metadata.',
    'Query Rows',
  ),
  data: descriptor(
    'data',
    'Query Rows',
    'Cassandra Rows',
    'Open a partition-key-first query workspace for this table.',
    'No row query target is available',
    'Refresh the table or open the CQL builder from the table node.',
    'Query Rows',
  ),
  columns: descriptor(
    'columns',
    'Open Columns',
    'Cassandra Columns',
    'Review column roles, CQL types, frozen values, collections, and clustering order.',
    'No columns were returned',
    'Refresh column metadata from system_schema.columns.',
  ),
  'primary-key': descriptor(
    'primary-key',
    'Open Primary Key',
    'Cassandra Primary Key',
    'Inspect partition and clustering key order so queries stay coordinator-friendly.',
    'No primary key metadata was returned',
    'Refresh the table and confirm system_schema column metadata is visible.',
  ),
  indexes: descriptor(
    'indexes',
    'Manage Indexes',
    'Cassandra Indexes',
    'Review SAI and secondary indexes, target columns, and guarded create/drop preview actions.',
    'No indexes were returned',
    'Refresh index metadata or create an index preview from the table actions.',
  ),
  index: descriptor(
    'index',
    'Open Index',
    'Cassandra Index',
    'Inspect index target, kind, options, and read-path guidance.',
    'No index metadata is loaded',
    'Refresh this index to collect system_schema.indexes metadata.',
  ),
  'materialized-views': descriptor(
    'materialized-views',
    'Open Materialized Views',
    'Cassandra Materialized Views',
    'Review derived query tables, base tables, and refresh/query constraints.',
    'No materialized views were returned',
    'Refresh materialized view metadata from system_schema.views.',
  ),
  'materialized-view': descriptor(
    'materialized-view',
    'Open Materialized View',
    'Cassandra Materialized View',
    'Inspect base table, primary key, included columns, and bounded query action.',
    'No materialized view metadata is loaded',
    'Refresh this view to collect system_schema.views metadata.',
    'Query View',
  ),
  types: descriptor(
    'types',
    'Open Types',
    'Cassandra Types',
    'Review user-defined types and the fields they expose to tables.',
    'No types were returned',
    'Refresh keyspace type metadata from system_schema.types.',
  ),
  type: descriptor(
    'type',
    'Open Type',
    'Cassandra Type',
    'Inspect user-defined type fields and dependent tables.',
    'No type metadata is loaded',
    'Refresh this type to collect field metadata.',
  ),
  functions: descriptor(
    'functions',
    'Open Functions',
    'Cassandra Functions',
    'Review user-defined functions and guarded create/drop preview options.',
    'No functions were returned',
    'Refresh function metadata from system_schema.functions.',
  ),
  function: descriptor(
    'function',
    'Open Function',
    'Cassandra Function',
    'Inspect function signature, language, deterministic flags, and return type.',
    'No function metadata is loaded',
    'Refresh this function to collect system_schema.functions metadata.',
  ),
  aggregates: descriptor(
    'aggregates',
    'Open Aggregates',
    'Cassandra Aggregates',
    'Review user-defined aggregate state and final functions.',
    'No aggregates were returned',
    'Refresh aggregate metadata from system_schema.aggregates.',
  ),
  aggregate: descriptor(
    'aggregate',
    'Open Aggregate',
    'Cassandra Aggregate',
    'Inspect aggregate state function, final function, initial condition, and return type.',
    'No aggregate metadata is loaded',
    'Refresh this aggregate to collect system_schema.aggregates metadata.',
  ),
  compaction: descriptor(
    'compaction',
    'Open Compaction',
    'Cassandra Compaction',
    'Review compaction strategy, compression, bloom filter, caching, and tombstone settings.',
    'No compaction metadata is loaded',
    'Refresh table options to inspect compaction and compression settings.',
  ),
  statistics: descriptor(
    'statistics',
    'Open Statistics',
    'Cassandra Statistics',
    'Review estimated partitions, size, SSTables, tombstones, read/write latency, and warning signals.',
    'No statistics were returned',
    'Refresh statistics or check diagnostic permissions.',
  ),
  permissions: descriptor(
    'permissions',
    'Review Permissions',
    'Cassandra Permissions',
    'Review roles and grants that can read, modify, or administer the selected object.',
    'No permissions were returned',
    'Refresh permissions or check role visibility.',
  ),
  security: descriptor(
    'security',
    'Review Security',
    'Cassandra Security',
    'Review roles, grants, authentication, and permission warnings.',
    'No security metadata was returned',
    'Refresh security metadata or check role permissions.',
  ),
  cluster: descriptor(
    'cluster',
    'Open Cluster',
    'Cassandra Cluster',
    'Review nodes, token ownership, datacenters, replication, and repair posture.',
    'No cluster metadata was returned',
    'Refresh cluster metadata or check system views.',
  ),
  diagnostics: descriptor(
    'diagnostics',
    'Open Diagnostics',
    'Cassandra Diagnostics',
    'Review sessions, tracing, compaction, repairs, dropped messages, and latency signals.',
    'No diagnostics were returned',
    'Refresh diagnostics or check access to system and virtual tables.',
  ),
  tracing: descriptor(
    'tracing',
    'Open Tracing',
    'Cassandra Tracing',
    'Review tracing sessions and coordinator-side latency detail.',
    'No tracing metadata was returned',
    'Enable tracing for a query or refresh the tracing view.',
  ),
  repairs: descriptor(
    'repairs',
    'Open Repairs',
    'Cassandra Repairs',
    'Review repair tasks, pending ranges, and anti-entropy health.',
    'No repair metadata was returned',
    'Refresh repairs or check nodetool/virtual-table access.',
  ),
}

export const CASSANDRA_OBJECT_VIEW_KINDS = new Set(
  Object.keys(CASSANDRA_OBJECT_VIEW_DESCRIPTORS),
)

export function getCassandraObjectViewDescriptor(kind: string | undefined): CassandraObjectViewDescriptor {
  const normalizedKind = normalizeKind(kind)
  return CASSANDRA_OBJECT_VIEW_DESCRIPTORS[normalizedKind]
    ?? descriptor(
      normalizedKind,
      'Inspect Cassandra Metadata',
      'Cassandra Metadata',
      'Review Cassandra metadata for the selected object.',
      'No metadata is loaded',
      'Refresh this object to collect Cassandra metadata.',
    )
}

export function cassandraObjectViewMenuLabel(kind: string | undefined): string {
  return getCassandraObjectViewDescriptor(kind).menuLabel
}

export function isCassandraObjectViewKind(kind: string | undefined): boolean {
  return CASSANDRA_OBJECT_VIEW_KINDS.has(normalizeKind(kind))
}

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): CassandraObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
    primaryQueryLabel,
  }
}

function normalizeKind(kind: string | undefined) {
  return (kind ?? 'object').trim().toLowerCase().replace(/_/g, '-')
}
