import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { branch, type ConnectionTreeNode } from './SideBar.connection-tree-types'

export function graphConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database?.trim()
  const rootLabel = connection.engine === 'arango' ? 'Graphs' : 'Databases'
  const graphRoots = database
    ? [
        branch(`graph-${database}`, database, 'graph', `${connection.engine} graph`, [
          branch('node-labels', 'Node Labels', 'node-labels', 'Vertex/node categories', []),
          branch('relationship-types', 'Relationship Types', 'relationship-types', 'Edges and relationship types', []),
          branch('property-keys', 'Property Keys', 'property-keys', 'Graph property definitions', []),
          branch('indexes', 'Indexes', 'indexes', 'Graph lookup indexes', []),
          branch('constraints', 'Constraints', 'constraints', 'Graph uniqueness and existence rules', []),
        ]),
      ]
    : []

  return [
    branch('graphs', rootLabel, 'graphs', 'Graph databases or named graphs', graphRoots),
    branch('procedures', graphProceduresLabel(connection), 'procedures', 'Procedures, services, algorithms, or loader jobs', []),
    branch('security', 'Security', 'security', 'Users, roles, IAM, and graph permissions', []),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'Query, storage, and schema health', []),
  ]
}

export function timeseriesConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'prometheus') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'PromQL metric families', []),
      branch('labels', 'Labels', 'labels', 'Metric dimensions', []),
      branch('targets', 'Targets', 'targets', 'Scrape targets', []),
      branch('rules', 'Rules', 'rules', 'Alerting and recording rules', []),
      branch('alerts', 'Alerts', 'alerts', 'Alert state', []),
      branch('service-discovery', 'Service Discovery', 'service-discovery', 'Discovered and dropped targets', []),
      branch('tsdb', 'TSDB / Storage', 'tsdb', 'Head blocks, WAL, and retention status', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Runtime and status metadata', []),
    ]
  }

  if (connection.engine === 'influxdb') {
    const bucket = connection.database?.trim()
    const bucketNodes = bucket
      ? [
          branch(`bucket-${bucket}`, bucket, 'bucket', 'InfluxDB bucket', [
            branch('measurements', 'Measurements', 'measurements', 'Measurement schema', []),
            branch('tags', 'Tags', 'tags', 'Indexed dimensions', []),
            branch('fields', 'Fields', 'fields', 'Value fields', []),
            branch('retention-policies', 'Retention Policies', 'retention-policies', 'Retention and shard groups', []),
          ]),
        ]
      : []

    return [
      branch('buckets', 'Buckets', 'buckets', 'InfluxDB buckets and retention scopes', bucketNodes),
      branch('tasks', 'Tasks', 'tasks', 'Scheduled Flux tasks', []),
      branch('security', 'Tokens', 'security', 'Authorizations and bucket scopes', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Cardinality, storage, and query health', []),
    ]
  }

  if (connection.engine === 'opentsdb') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'OpenTSDB metric names', []),
      branch('tags', 'Tags', 'tags', 'Tag keys and values', []),
      branch('aggregators', 'Aggregators', 'aggregators', 'Supported aggregation functions', []),
      branch('downsampling', 'Downsampling', 'downsampling', 'Downsample windows and fill policies', []),
      branch('uid-metadata', 'UID Metadata', 'uid-metadata', 'Metric and tag UID metadata', []),
      branch('trees', 'Trees', 'trees', 'OpenTSDB tree definitions', []),
      branch('stats', 'Stats', 'stats', 'OpenTSDB runtime stats', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Backend health and query risk', []),
    ]
  }

  return [
    branch('buckets', 'Buckets', 'buckets', 'Time-series storage scopes', []),
  ]
}

export function wideColumnConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'dynamodb') {
    return [
      branch('dynamodb-tables', 'Tables', 'tables', 'DynamoDB tables', []),
      branch('dynamodb-access', 'Access', 'security', 'IAM and table policies', [
        branch('dynamodb-permissions', 'Permissions', 'permissions', 'Visible table, stream, and index privileges', []),
        branch('dynamodb-policies', 'Table Policies', 'policies', 'Resource policies and disabled action reasons', []),
      ]),
      branch('dynamodb-diagnostics', 'Diagnostics', 'diagnostics', 'Consumed capacity, throttles, and costs', [
        branch('dynamodb-capacity', 'Capacity', 'capacity', 'Read/write usage, throttles, and latency', []),
        branch('dynamodb-hot-partitions', 'Hot Partitions', 'hot-partitions', 'High-traffic partition keys', []),
        branch('dynamodb-alarms', 'Alarms', 'alarms', 'Capacity, latency, and stream alarms', []),
        branch('dynamodb-backups', 'Backups', 'backups', 'PITR and on-demand backups', []),
      ]),
    ]
  }

  if (connection.engine === 'cassandra') {
    const keyspace = connection.database?.trim()
    const roots = keyspace
      ? [
          branch(`cassandra-keyspace-${keyspace}`, keyspace, 'keyspace', 'Selected Cassandra keyspace', [
            ...cassandraKeyspaceChildren(),
          ]),
        ]
      : [
          branch('cassandra-keyspaces', 'Keyspaces', 'keyspaces', 'Cassandra keyspaces', []),
          branch('cassandra-system-keyspaces', 'System Keyspaces', 'system-keyspaces', 'system_schema, system, and tracing metadata', []),
        ]

    return [
      ...roots,
      branch('cassandra-cluster', 'Cluster', 'cluster', 'Nodes, datacenters, token ownership, and replication', [
        branch('cassandra-nodes', 'Nodes', 'nodes', 'Node status, datacenter, rack, and token ownership', []),
        branch('cassandra-replication', 'Replication', 'statistics', 'Replication strategy and factor by keyspace', []),
        branch('cassandra-repairs', 'Repairs', 'repairs', 'Repair and anti-entropy posture', []),
      ]),
      branch('cassandra-security', 'Security', 'security', 'Roles and permissions', [
        branch('cassandra-roles', 'Roles', 'security', 'Role hierarchy and login state', []),
        branch('cassandra-permissions', 'Permissions', 'permissions', 'Visible grants and resource permissions', []),
      ]),
      branch('cassandra-diagnostics', 'Diagnostics', 'diagnostics', 'Tracing, compaction, repair, and cluster status', [
        branch('cassandra-tracing', 'Tracing', 'tracing', 'Trace sessions and latency detail', []),
        branch('cassandra-compaction', 'Compaction', 'compaction', 'Pending compactions and throughput', []),
        branch('cassandra-statistics', 'Statistics', 'statistics', 'Read/write latency and tombstone signals', []),
      ]),
    ]
  }

  return [
    branch('keyspaces', 'Keyspaces', 'keyspaces', 'Wide-column namespaces', []),
  ]
}

export function searchConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const engineLabel = connection.engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'

  return [
    branch('search-cluster', 'Cluster', 'cluster', `${engineLabel} health and topology`, [
      branch('search-health', 'Health', 'health', 'Cluster health and shard allocation', []),
      branch('search-nodes', 'Nodes', 'nodes', 'Node roles, heap, disk, CPU, and indexing/search load', []),
      branch('search-shard-allocation', 'Shard Allocation', 'shards', 'Shard routing and node placement', []),
    ]),
    branch('search-indices', 'Indices', 'indices', 'Search indexes', []),
    branch('search-data-streams', 'Data Streams', 'data-streams', 'Append-oriented streams', []),
    branch('search-aliases', 'Aliases', 'aliases', 'Index aliases and routing', []),
    branch('search-templates', 'Templates', 'templates', 'Index and component templates', [
      branch('search-index-templates', 'Index Templates', 'templates', 'Composable index templates', []),
      branch('search-component-templates', 'Component Templates', 'templates', 'Reusable template components', []),
    ]),
    branch('search-pipelines', 'Pipelines', 'pipelines', 'Ingest pipelines', []),
    branch('search-security', 'Security', 'security', 'Roles, users, and index privileges', [
      branch('search-users', 'Users', 'users', 'Visible users and realms', []),
      branch('search-roles', 'Roles', 'roles', 'Cluster and index privileges', []),
      branch('search-api-keys', 'API Keys', 'api-keys', 'API keys and expiry state', []),
    ]),
    branch('search-diagnostics', 'Diagnostics', 'diagnostics', 'Shards, segments, tasks, snapshots, and lifecycle', [
      branch('search-shards', 'Shards', 'shards', 'Shard routing and state', []),
      branch('search-segments', 'Segments', 'segments', 'Lucene segment counts and deleted docs', []),
      branch('search-tasks', 'Tasks', 'tasks', 'Active task list', []),
      branch('search-snapshots', 'Snapshots', 'snapshots', 'Snapshot repositories and states', []),
      branch('search-lifecycle', 'Lifecycle Policies', 'lifecycle-policies', 'ILM or ISM policy status', []),
    ]),
  ]
}

export function analyticsConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const dataset = connection.database?.trim()
  const namespace = warehouseNamespace(connection)
  const namespaceChildren = dataset
    ? [
        branch(
          `${namespace.singleKind}-${dataset}`,
          dataset,
          namespace.singleKind,
          namespace.singleDetail,
          [
            branch('warehouse-tables', 'Tables', 'tables', 'Columnar tables and partitions', []),
            branch('warehouse-views', 'Views', 'views', 'Saved analytical projections', []),
            branch('warehouse-materialized-views', 'Materialized Views', 'materialized-views', 'Persisted analytical views', []),
            branch('warehouse-stages', warehouseStageLabel(connection), 'stages', 'Load and unload locations', []),
            branch('warehouse-jobs-local', warehouseJobsLabel(connection), 'jobs', 'Recent jobs and scheduled work', []),
          ],
        ),
      ]
    : []

  return [
    branch(namespace.rootId, namespace.rootLabel, namespace.rootKind, namespace.rootDetail, namespaceChildren),
    branch('warehouse-compute', warehouseComputeLabel(connection), 'warehouses', warehouseComputeDetail(connection), []),
    branch('warehouse-jobs', warehouseJobsLabel(connection), 'jobs', 'Query history, jobs, and scheduled work', []),
    branch('warehouse-security', 'Security', 'security', warehouseSecurityDetail(connection), []),
    branch('warehouse-diagnostics', 'Diagnostics', 'diagnostics', 'Cost, runtime, queueing, and storage health', []),
  ]
}

function cassandraKeyspaceChildren(): ConnectionTreeNode[] {
  return [
    branch('cassandra-tables', 'Tables', 'tables', 'Partition-key-first tables', []),
    branch('cassandra-materialized-views', 'Materialized Views', 'materialized-views', 'Derived query tables', []),
    branch('cassandra-indexes', 'Indexes', 'indexes', 'SAI and secondary indexes', []),
    branch('cassandra-types', 'Types', 'types', 'User-defined types', []),
    branch('cassandra-functions', 'Functions', 'functions', 'User-defined functions', []),
    branch('cassandra-aggregates', 'Aggregates', 'aggregates', 'User-defined aggregates', []),
    branch('cassandra-keyspace-permissions', 'Permissions', 'permissions', 'Visible grants for this keyspace', []),
  ]
}

function warehouseNamespace(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return {
      rootId: 'warehouse-datasets',
      rootLabel: 'Datasets',
      rootKind: 'datasets',
      rootDetail: 'BigQuery datasets',
      singleKind: 'dataset',
      singleDetail: 'BigQuery dataset',
    }
  }

  return {
    rootId: 'warehouse-databases',
    rootLabel: 'Databases',
    rootKind: 'databases',
    rootDetail: `${connection.engine} databases`,
    singleKind: 'database',
    singleDetail: `${connection.engine} database`,
  }
}

function warehouseStageLabel(connection: ConnectionProfile) {
  return connection.engine === 'clickhouse' || connection.engine === 'bigquery'
    ? 'External Tables'
    : 'Stages'
}

function warehouseComputeLabel(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return 'Reservations'
  }

  return connection.engine === 'clickhouse' ? 'Clusters' : 'Warehouses'
}

function warehouseComputeDetail(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return 'Slots, reservations, and assignments'
  }

  return connection.engine === 'clickhouse'
    ? 'Cluster topology and replicas'
    : 'Compute warehouses'
}

function warehouseJobsLabel(connection: ConnectionProfile) {
  return connection.engine === 'snowflake' ? 'Tasks & Query History' : 'Jobs'
}

function warehouseSecurityDetail(connection: ConnectionProfile) {
  return connection.engine === 'bigquery'
    ? 'IAM and dataset access'
    : 'Roles and grants'
}

function graphProceduresLabel(connection: ConnectionProfile) {
  return connection.engine === 'neptune'
    ? 'Loader Jobs'
    : connection.engine === 'arango'
      ? 'Services'
      : 'Procedures'
}
