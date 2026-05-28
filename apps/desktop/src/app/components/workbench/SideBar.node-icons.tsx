import type { ComponentType, SVGProps } from 'react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  ExplorerIcon,
  ObjectBinaryIcon,
  ObjectBucketIcon,
  ObjectCollectionIcon,
  ObjectColumnIcon,
  ObjectConstraintIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectFunctionIcon,
  ObjectGenericIcon,
  ObjectGraphIcon,
  ObjectHashIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectKeyIcon,
  ObjectListIcon,
  ObjectMappingIcon,
  ObjectMemoryIcon,
  ObjectMetricIcon,
  ObjectPackageIcon,
  ObjectPartitionIcon,
  ObjectProcedureIcon,
  ObjectRelationshipIcon,
  ObjectRoleIcon,
  ObjectSchemaIcon,
  ObjectSearchIcon,
  ObjectSecurityIcon,
  ObjectSeriesIcon,
  ObjectServerIcon,
  ObjectSetIcon,
  ObjectStageIcon,
  ObjectStreamIcon,
  ObjectTableIcon,
  ObjectTriggerIcon,
  ObjectTypeIcon,
  ObjectViewIcon,
  ObjectWarehouseIcon,
} from './icons'
import { DatastoreIcon } from './DatastoreIcon'
import {
  TreeFolderIcon,
  TreeFolderOpenIcon,
  TreePrefixIcon,
} from './FolderTreeIcons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface IconDescriptor {
  Icon: IconComponent
  OpenIcon?: IconComponent
  tone: string
}

const KIND_ICON_GROUPS: Array<[string[], IconDescriptor]> = [
  [
    [
      'account',
      'accounts',
      'catalog',
      'catalogs',
      'database',
      'databases',
      'dataset',
      'datasets',
      'db',
      'dbs',
      'keyspace',
      'keyspaces',
      'namespace',
      'namespaces',
      'container',
      'containers',
      'cdb',
      'pdb',
      'pluggable-database',
      'pluggable-databases',
      'system-databases',
    ],
    { Icon: ObjectDatabaseIcon, tone: 'database' },
  ],
  [
    ['schema', 'schemas', 'system-schemas', 'user-schemas'],
    { Icon: ObjectSchemaIcon, tone: 'schema' },
  ],
  [
    ['bucket', 'buckets'],
    { Icon: ObjectBucketIcon, tone: 'bucket' },
  ],
  [
    ['folder', 'folders', 'group', 'groups', 'category', 'categories'],
    { Icon: TreeFolderIcon, OpenIcon: TreeFolderOpenIcon, tone: 'folder' },
  ],
  [
    [
      'base-table',
      'base-tables',
      'external-table',
      'external-tables',
      'filetable',
      'filetables',
      'graph-table',
      'graph-tables',
      'hypertable',
      'hypertables',
      'node-table',
      'node-tables',
      'edge-table',
      'edge-tables',
      'materialized-view-table',
      'strict-table',
      'system-table',
      'system-tables',
      'table',
      'tables',
      'virtual-table',
      'virtual-tables',
      'fts-table',
      'fts-tables',
      'rtree-table',
      'rtree-tables',
      'wide-table',
      'wide-tables',
    ],
    { Icon: ObjectTableIcon, tone: 'table' },
  ],
  [
    ['view', 'views', 'materialized-view', 'materialized-views'],
    { Icon: ObjectViewIcon, tone: 'view' },
  ],
  [
    ['column', 'columns', 'generated-column', 'generated-columns', 'field', 'fields', 'attribute', 'attributes', 'partition-key', 'partition-keys', 'property', 'properties'],
    { Icon: ObjectColumnIcon, tone: 'column' },
  ],
  [
    [
      'gsi',
      'gsis',
      'index',
      'indexes',
      'indices',
      'indexing-policy',
      'indexing-policies',
      'inverted-index',
      'inverted-indexes',
      'lsi',
      'lsis',
      'materialized-index',
      'search-index',
      'search-indexes',
      'secondary-index',
      'secondary-indexes',
      'vector-index',
      'vector-indexes',
    ],
    { Icon: ObjectIndexIcon, tone: 'index' },
  ],
  [
    [
      'check-constraint',
      'constraint',
      'constraints',
      'foreign-key',
      'foreign-keys',
      'primary-key',
      'primary-keys',
      'unique-constraint',
      'unique-constraints',
    ],
    { Icon: ObjectConstraintIcon, tone: 'constraint' },
  ],
  [
    ['function', 'functions', 'scalar-function', 'scalar-functions', 'table-valued-function', 'table-valued-functions'],
    { Icon: ObjectFunctionIcon, tone: 'function' },
  ],
  [
    ['package', 'packages', 'package-spec', 'package-body', 'program', 'programmability', 'routine', 'routines'],
    { Icon: ObjectPackageIcon, tone: 'package' },
  ],
  [
    [
      'procedure',
      'procedures',
      'stored-procedure',
      'stored-procedures',
      'storedprocedure',
      'storedprocedures',
    ],
    { Icon: ObjectProcedureIcon, tone: 'procedure' },
  ],
  [
    ['trigger', 'triggers'],
    { Icon: ObjectTriggerIcon, tone: 'trigger' },
  ],
  [
    [
      'capped-collection',
      'capped-collections',
      'collection',
      'collections',
      'json-collection',
      'json-collections',
      'time-series-collection',
      'time-series-collections',
    ],
    { Icon: ObjectCollectionIcon, tone: 'collection' },
  ],
  [
    ['document', 'documents', 'sample-document', 'sample-documents', 'schema-preview'],
    { Icon: ObjectDocumentIcon, tone: 'document' },
  ],
  [
    ['aggregation', 'aggregations', 'pipeline', 'validation-rules'],
    { Icon: ObjectPackageIcon, tone: 'package' },
  ],
  [
    ['data-stream', 'data-streams', 'stream', 'streams'],
    { Icon: ObjectStreamIcon, tone: 'stream' },
  ],
  [
    ['mapping', 'mappings'],
    { Icon: ObjectMappingIcon, tone: 'mapping' },
  ],
  [
    ['hash', 'hashes'],
    { Icon: ObjectHashIcon, tone: 'hash' },
  ],
  [
    ['key', 'keys', 'string', 'strings'],
    { Icon: ObjectKeyIcon, tone: 'key' },
  ],
  [
    ['prefix', 'prefixes', 'key-prefix', 'key-prefixes'],
    { Icon: TreePrefixIcon, OpenIcon: TreeFolderOpenIcon, tone: 'prefix' },
  ],
  [
    ['list', 'lists', 'queue', 'queues', 'queue-table', 'queue-tables'],
    { Icon: ObjectListIcon, tone: 'list' },
  ],
  [
    ['set', 'sets', 'sorted-set', 'sorted-sets', 'zset', 'zsets'],
    { Icon: ObjectSetIcon, tone: 'set' },
  ],
  [
    ['graph', 'graphs', 'node-label', 'node-labels', 'vertex-label', 'vertex-labels'],
    { Icon: ObjectGraphIcon, tone: 'graph' },
  ],
  [
    ['dependency', 'dependencies', 'edge', 'edges', 'relationship', 'relationships', 'relationship-type', 'relationship-types', 'synonym', 'synonyms', 'contention'],
    { Icon: ObjectRelationshipIcon, tone: 'relationship' },
  ],
  [
    [
      'collection-statistics',
      'database-statistics',
      'db-stats',
      'diagnostic',
      'diagnostics',
      'metric',
      'metrics',
      'measurement',
      'measurements',
      'uid',
      'uid-metadata',
      'performance',
      'series',
      'request-unit',
      'request-units',
      'ru',
      'rus',
      'statement',
      'statements',
      'statistic',
      'statistics',
      'stats',
    ],
    { Icon: ObjectMetricIcon, tone: 'metric' },
  ],
  [
    [
      'alert',
      'alerts',
      'aggregator',
      'aggregators',
      'chain',
      'chains',
      'management',
      'maintenance',
      'operator',
      'operators',
      'program',
      'programs',
      'proxy',
      'proxies',
      'rule',
      'rules',
      'schedule',
      'schedules',
      'scheduler',
      'sequence',
      'sequences',
      'cluster-setting',
      'cluster-settings',
      'target',
      'targets',
      'task',
      'tasks',
      'window',
      'windows',
    ],
    { Icon: ObjectSeriesIcon, tone: 'series' },
  ],
  [
    [
      'agent',
      'compilation-error',
      'compilation-errors',
      'error',
      'errors',
      'execution-plan',
      'history',
      'invalid-object',
      'invalid-objects',
      'job',
      'jobs',
      'lock',
      'locks',
      'query-history',
      'query-plan',
      'query-store',
      'query-store-view',
      'session',
      'sessions',
      'sql-monitor',
      'sql-server-agent',
      'sentinel-failover',
      'throughput',
      'transaction',
      'transactions',
      'wait',
      'waits',
    ],
    { Icon: ObjectJobIcon, tone: 'job' },
  ],
  [
    ['login', 'logins', 'role', 'roles', 'user', 'users'],
    { Icon: ObjectRoleIcon, tone: 'role' },
  ],
  [
    ['credential', 'credentials', 'permission', 'permissions', 'privilege', 'privileges', 'grant', 'grants', 'profile', 'profiles', 'security', 'certificate', 'certificates', 'symmetric-key', 'symmetric-keys', 'asymmetric-key', 'asymmetric-keys', 'audit', 'audits'],
    { Icon: ObjectSecurityIcon, tone: 'security' },
  ],
  [
    ['stage', 'stages', 'storage', 'snapshot', 'snapshots', 'database-snapshot', 'database-snapshots', 'backup', 'backups', 'tablespace', 'tablespaces', 'data-file', 'data-files', 'segment', 'segments', 'quota', 'quotas', 'flashback', 'restore-point', 'restore-points', 'recycle-bin', 'filegroup', 'filegroups', 'partition-scheme', 'partition-schemes', 'partition-function', 'partition-functions', 'database-diagram', 'database-diagrams', 'zone-configuration', 'zone-configurations'],
    { Icon: ObjectStageIcon, tone: 'stage' },
  ],
  [
    ['warehouse', 'warehouses', 'cluster', 'clusters', 'cluster-node', 'cluster-nodes', 'cluster-failover', 'data-guard', 'rac', 'instance', 'instances', 'sentinel', 'sentinel-master', 'sentinel-masters', 'sentinel-peer', 'sentinel-peers', 'sentinel-replica', 'sentinel-replicas', 'service', 'services', 'availability-group', 'availability-groups', 'always-on', 'always-on-high-availability', 'analysis-services', 'integration-services-catalogs', 'reporting-services'],
    { Icon: ObjectWarehouseIcon, tone: 'warehouse' },
  ],
  [
    ['server', 'servers', 'server-object', 'server-objects', 'database-link', 'database-links', 'db-link', 'db-links', 'linked-server', 'linked-servers', 'endpoint', 'endpoints', 'node', 'nodes'],
    { Icon: ObjectServerIcon, tone: 'server' },
  ],
  [
    ['assembly', 'assemblies', 'type', 'types', 'udt', 'udts', 'xml-schema', 'xml-schemas'],
    { Icon: ObjectTypeIcon, tone: 'type' },
  ],
  [
    ['chunk', 'chunks', 'cluster-slot', 'cluster-slots', 'conflict', 'conflicts', 'consistency', 'locality', 'localities', 'partition', 'partitions', 'range', 'ranges', 'region', 'regions'],
    { Icon: ObjectPartitionIcon, tone: 'partition' },
  ],
  [
    ['downsampler', 'downsamplers', 'downsampling', 'tree', 'trees'],
    { Icon: ObjectStageIcon, tone: 'stage' },
  ],
  [
    ['binary', 'blob', 'blobs', 'file', 'files', 'file-storage', 'gridfs', 'gridfs-collection', 'xml-db', 'java-source', 'java-sources', 'attached-database', 'attached-databases'],
    { Icon: ObjectBinaryIcon, tone: 'binary' },
  ],
  [
    ['ddl', 'definition', 'lua-script', 'lua-scripts', 'script', 'scripts', 'source', 'source-line', 'source-lines'],
    { Icon: ObjectDocumentIcon, tone: 'document' },
  ],
  [
    ['cache', 'caches', 'item-class', 'item-classes', 'memory', 'pragma', 'pragmas', 'slab', 'slabs'],
    { Icon: ObjectMemoryIcon, tone: 'memory' },
  ],
  [
    ['index-template', 'index-templates', 'indices-root', 'search', 'full-text-search'],
    { Icon: ObjectSearchIcon, tone: 'search' },
  ],
  [
    ['replication', 'cdc', 'change-feed', 'change-tracking', 'service-broker'],
    { Icon: ObjectRelationshipIcon, tone: 'relationship' },
  ],
  [
    ['extended-events', 'xevent-profiler'],
    { Icon: ObjectMetricIcon, tone: 'metric' },
  ],
]

const KIND_ICON_LOOKUP = new Map(
  KIND_ICON_GROUPS.flatMap(([kinds, descriptor]) =>
    kinds.map((kind) => [kind, descriptor] as const),
  ),
)

export function EngineIcon({ connection }: { connection: ConnectionProfile }) {
  return (
    <DatastoreIcon
      decorative={false}
      engine={connection.engine}
      label={`${connection.name} datastore icon`}
    />
  )
}

export function ExplorerNodeIcon({
  expanded = false,
  kind,
}: {
  connection?: ConnectionProfile
  expanded?: boolean
  kind: string
}) {
  const descriptor = iconDescriptorForKind(kind)
  const Icon = expanded && descriptor.OpenIcon ? descriptor.OpenIcon : descriptor.Icon

  return (
    <Icon
      className={`tree-icon tree-kind-icon tree-kind-icon--${descriptor.tone}`}
    />
  )
}

function iconDescriptorForKind(kind: string): IconDescriptor {
  return KIND_ICON_LOOKUP.get(normalizeObjectKind(kind)) ?? {
    Icon: fallbackIconForKind(kind),
    tone: 'generic',
  }
}

function fallbackIconForKind(kind: string) {
  const normalized = normalizeObjectKind(kind)

  if (normalized.includes('table')) {
    return ObjectTableIcon
  }

  if (normalized.includes('index')) {
    return ObjectIndexIcon
  }

  if (normalized.includes('view')) {
    return ObjectViewIcon
  }

  if (normalized.includes('function')) {
    return ObjectFunctionIcon
  }

  if (normalized.includes('procedure') || normalized.includes('routine')) {
    return ObjectProcedureIcon
  }

  if (normalized.includes('collection')) {
    return ObjectCollectionIcon
  }

  if (normalized.includes('stream')) {
    return ObjectStreamIcon
  }

  if (normalized.includes('key')) {
    return ObjectKeyIcon
  }

  if (normalized.includes('graph')) {
    return ObjectGraphIcon
  }

  if (normalized.includes('database') || normalized.includes('schema')) {
    return ObjectDatabaseIcon
  }

  return normalized ? ObjectGenericIcon : ExplorerIcon
}

function normalizeObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
