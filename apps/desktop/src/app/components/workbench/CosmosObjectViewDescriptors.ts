export type CosmosObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, CosmosObjectViewDescriptor> = {
  account: descriptor('account', 'Open Account Overview', 'Cosmos DB Account', 'Review account topology, APIs, databases, consistency, regions, security, and diagnostics.', 'No account metadata is loaded', 'Refresh the account or verify the current identity can read Cosmos DB metadata.'),
  databases: descriptor('databases', 'Open Databases', 'Cosmos DB Databases', 'Review databases, container counts, throughput posture, and item storage at a glance.', 'No databases were returned', 'This account may not contain visible databases.'),
  database: descriptor('database', 'Open Database', 'Cosmos DB Database', 'Inspect containers, shared throughput, security, and database-level diagnostics.', 'No database metadata is loaded', 'Refresh this database or check permissions.'),
  containers: descriptor('containers', 'Open Containers', 'Cosmos DB Containers', 'Review containers, partition keys, throughput, indexing policy, TTL, and change-feed readiness.', 'No containers were returned', 'This database may not contain visible containers.'),
  container: descriptor('container', 'Open Container', 'Cosmos DB Container', 'Inspect items, partitioning, indexing, throughput, TTL, change feed, scripts, and diagnostics.', 'No container metadata is loaded', 'Refresh this container or check that it still exists.', 'Open Items Query'),
  items: descriptor('items', 'Open Items', 'Cosmos DB Items', 'Run a bounded container query using the active database and partitioning context.', 'No item query target is loaded', 'Open the query action to browse container items.', 'Open Items Query'),
  'partition-key': descriptor('partition-key', 'Review Partition Key', 'Partition Key', 'Review partition key path, kind, uniqueness, hot partition hints, and query-routing guidance.', 'No partition-key metadata is loaded', 'Refresh this container to collect partition metadata.'),
  'indexing-policy': descriptor('indexing-policy', 'Review Indexing Policy', 'Indexing Policy', 'Review included paths, excluded paths, composite indexes, spatial indexes, and indexing mode.', 'No indexing policy is loaded', 'Refresh indexing policy metadata for this container.'),
  throughput: descriptor('throughput', 'Open Throughput', 'Throughput', 'Review manual/autoscale RU/s, shared throughput, throttles, and cost-risk hints.', 'No throughput metadata is loaded', 'Throughput may be inherited or not visible to this identity.'),
  'change-feed': descriptor('change-feed', 'Open Change Feed', 'Change Feed', 'Review lease/container readiness, retention hints, and change-feed processor posture.', 'No change-feed metadata is loaded', 'Change-feed metadata may be unavailable in preview.'),
  'stored-procedures': descriptor('stored-procedures', 'Manage Stored Procedures', 'Stored Procedures', 'Review container stored procedures and guarded create/replace/delete previews.', 'No stored procedures were returned', 'This container may not define stored procedures.'),
  triggers: descriptor('triggers', 'Manage Triggers', 'Triggers', 'Review pre/post triggers, operations, and guarded management previews.', 'No triggers were returned', 'This container may not define triggers.'),
  udfs: descriptor('udfs', 'Manage UDFs', 'User Defined Functions', 'Review user-defined functions and guarded management previews.', 'No UDFs were returned', 'This container may not define user-defined functions.'),
  conflicts: descriptor('conflicts', 'Review Conflicts', 'Conflict Feed', 'Review multi-region conflict metadata and resolution policy hints.', 'No conflicts were returned', 'No conflicts are visible or multi-master is disabled.'),
  regions: descriptor('regions', 'Review Regions', 'Regions', 'Review write/read regions, failover priority, availability, and replication posture.', 'No region metadata is loaded', 'Refresh account metadata to collect regions.'),
  consistency: descriptor('consistency', 'Review Consistency', 'Consistency', 'Review default consistency, bounded-staleness settings, and session token guidance.', 'No consistency metadata is loaded', 'Refresh account metadata to collect consistency settings.'),
  security: descriptor('security', 'Review Security', 'Cosmos DB Security', 'Review identities, RBAC roles, key usage posture, networking, and disabled-operation reasons.', 'No security metadata is loaded', 'Security metadata may be restricted.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Cosmos DB Diagnostics', 'Review RU consumption, throttles, storage, latency, regions, and indexing warnings.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available signals.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Cosmos DB Object',
  'Cosmos DB Object',
  'Review available Cosmos DB metadata for this object.',
  'Cosmos DB metadata is not available',
  'Refresh this object or check whether the account can inspect it.',
)

export function getCosmosObjectViewDescriptor(kind: string | undefined): CosmosObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeCosmosObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function cosmosObjectViewMenuLabel(kind: string | undefined): string {
  return getCosmosObjectViewDescriptor(kind).menuLabel
}

export function isCosmosObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeCosmosObjectKind(kind)])
}

export const COSMOS_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): CosmosObjectViewDescriptor {
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

function normalizeCosmosObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
