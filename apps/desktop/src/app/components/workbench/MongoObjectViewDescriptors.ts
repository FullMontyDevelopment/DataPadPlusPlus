export type MongoObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, MongoObjectViewDescriptor> = {
  database: {
    kind: 'database',
    menuLabel: 'Open Database Overview',
    title: 'Database Overview',
    purpose: 'Review the database structure, security surfaces, GridFS areas, and statistics before opening a focused MongoDB workflow.',
    emptyTitle: 'Database metadata is not loaded yet',
    emptyDescription: 'Refresh the view to collect collections, views, security, GridFS, and statistics metadata for this database.',
  },
  collection: {
    kind: 'collection',
    menuLabel: 'Open Collection Overview',
    title: 'Collection Overview',
    purpose: 'Work with documents, schema, indexes, validation rules, statistics, permissions, and collection-level operation previews.',
    emptyTitle: 'Collection metadata is not loaded yet',
    emptyDescription: 'Refresh the collection view or open Documents to inspect data and collect richer collection metadata.',
    primaryQueryLabel: 'Open Documents',
  },
  view: {
    kind: 'view',
    menuLabel: 'Inspect View Definition',
    title: 'MongoDB View',
    purpose: 'Inspect the backing pipeline, dependencies, and sample results for this read-only MongoDB view.',
    emptyTitle: 'View metadata is not loaded yet',
    emptyDescription: 'Refresh the view to collect its backing pipeline and dependency metadata.',
    primaryQueryLabel: 'Open Sample Results',
  },
  'schema-preview': {
    kind: 'schema-preview',
    menuLabel: 'Open Schema Preview',
    title: 'Schema Preview',
    purpose: 'Understand document shape from bounded samples: field presence, BSON types, examples, mixed-type fields, and validator opportunities.',
    emptyTitle: 'No schema sample is available',
    emptyDescription: 'Run or refresh schema sampling after the collection has documents. DataPad++ keeps this bounded so large collections stay safe.',
  },
  indexes: {
    kind: 'indexes',
    menuLabel: 'Manage Indexes',
    title: 'Index Manager',
    purpose: 'Review collection access paths, options, usage hints, and generate guarded create/drop index operation previews.',
    emptyTitle: 'No index metadata is available',
    emptyDescription: 'Refresh indexes or verify that the connected user can run listIndexes for this collection.',
  },
  'search-indexes': {
    kind: 'search-indexes',
    menuLabel: 'Manage Search Indexes',
    title: 'Search Indexes',
    purpose: 'Review Atlas Search index metadata when the connected deployment exposes it, with unavailable actions explained inline.',
    emptyTitle: 'Search index metadata is unavailable',
    emptyDescription: 'This deployment did not expose Atlas Search index metadata through the connected MongoDB APIs.',
  },
  'vector-indexes': {
    kind: 'vector-indexes',
    menuLabel: 'Manage Vector Indexes',
    title: 'Vector Indexes',
    purpose: 'Review vector search metadata when the connected deployment exposes it, with unavailable actions explained inline.',
    emptyTitle: 'Vector index metadata is unavailable',
    emptyDescription: 'This deployment did not expose vector index metadata through the connected MongoDB APIs.',
  },
  'validation-rules': {
    kind: 'validation-rules',
    menuLabel: 'Manage Validation Rules',
    title: 'Validation Rules',
    purpose: 'Inspect the active validator, test draft documents, and generate guarded validator update previews.',
    emptyTitle: 'No validator is configured',
    emptyDescription: 'This collection currently accepts documents without a collection validator. You can draft one here as a guarded preview.',
  },
  'collection-statistics': {
    kind: 'collection-statistics',
    menuLabel: 'Open Collection Statistics',
    title: 'Collection Statistics',
    purpose: 'Measure collection size, document counts, average object size, storage, and index footprint in a compact diagnostics view.',
    emptyTitle: 'No collection statistics were returned',
    emptyDescription: 'Refresh statistics or verify that the connected user can run collection statistics commands.',
  },
  'database-statistics': {
    kind: 'database-statistics',
    menuLabel: 'Open Database Statistics',
    title: 'Database Statistics',
    purpose: 'Measure database-level storage, object counts, collection counts, index footprint, and command output.',
    emptyTitle: 'No database statistics were returned',
    emptyDescription: 'Refresh statistics or verify that the connected user can run database statistics commands.',
  },
  permissions: {
    kind: 'permissions',
    menuLabel: 'Open Permissions',
    title: 'Permissions',
    purpose: 'Review permission-related metadata for the selected collection or database and surface unavailable privilege details clearly.',
    emptyTitle: 'No permission metadata was returned',
    emptyDescription: 'The connected user may not be allowed to inspect permissions for this scope.',
  },
  scripts: {
    kind: 'scripts',
    menuLabel: 'Open Scripts',
    title: 'Scripts',
    purpose: 'Start MongoDB scripting workflows and reusable operation templates scoped to this object.',
    emptyTitle: 'No script templates are available',
    emptyDescription: 'Open the scripting workspace to create a scoped script for this MongoDB object.',
    primaryQueryLabel: 'Open Scripting',
  },
  aggregations: {
    kind: 'aggregations',
    menuLabel: 'Open Aggregation Builder',
    title: 'Aggregation Builder',
    purpose: 'Build and run aggregation pipelines scoped to this collection without losing the raw pipeline representation.',
    emptyTitle: 'No aggregation templates are available',
    emptyDescription: 'Open the aggregation builder to start a scoped pipeline for this collection.',
    primaryQueryLabel: 'Open Aggregation Builder',
  },
  pipeline: {
    kind: 'pipeline',
    menuLabel: 'Open Pipeline',
    title: 'View Pipeline',
    purpose: 'Inspect the pipeline that defines this MongoDB view and open sample results from the same scope.',
    emptyTitle: 'No pipeline was returned',
    emptyDescription: 'Refresh the view or verify that listCollections returned pipeline metadata for this view.',
    primaryQueryLabel: 'Open Sample Results',
  },
  gridfs: {
    kind: 'gridfs',
    menuLabel: 'Browse GridFS',
    title: 'GridFS Browser',
    purpose: 'Browse GridFS buckets, files, chunks, metadata, and query/export entry points for file-backed collections.',
    emptyTitle: 'No GridFS metadata is loaded',
    emptyDescription: 'Refresh GridFS metadata to list buckets, file metadata collections, and chunk collections.',
  },
  'gridfs-buckets': {
    kind: 'gridfs-buckets',
    menuLabel: 'Browse GridFS Buckets',
    title: 'GridFS Buckets',
    purpose: 'List GridFS bucket prefixes and jump into their files and chunks collections.',
    emptyTitle: 'No GridFS buckets were found',
    emptyDescription: 'This database may not contain GridFS bucket collections, or the connected user may not be allowed to list them.',
  },
  'gridfs-bucket': {
    kind: 'gridfs-bucket',
    menuLabel: 'Open GridFS Bucket',
    title: 'GridFS Bucket',
    purpose: 'Inspect a GridFS bucket and open its files or chunks collections as focused document queries.',
    emptyTitle: 'GridFS bucket metadata is not loaded',
    emptyDescription: 'Refresh the bucket metadata or query the bucket backing collections directly.',
  },
  users: {
    kind: 'users',
    menuLabel: 'Manage Users',
    title: 'Users',
    purpose: 'Review database users, assigned roles, authentication details, and generate guarded user management previews.',
    emptyTitle: 'No users were returned',
    emptyDescription: 'The connected user may not have usersInfo privileges, or this database has no user records available to this login.',
  },
  roles: {
    kind: 'roles',
    menuLabel: 'Manage Roles',
    title: 'Roles',
    purpose: 'Review role inheritance, privileges, and generate guarded role management previews.',
    emptyTitle: 'No roles were returned',
    emptyDescription: 'The connected user may not have rolesInfo privileges, or this database has no role records available to this login.',
  },
}

const DEFAULT_DESCRIPTOR: MongoObjectViewDescriptor = {
  kind: 'object',
  menuLabel: 'Inspect Mongo Metadata',
  title: 'Mongo Metadata',
  purpose: 'Inspect MongoDB metadata for this object with available warnings and query handoffs.',
  emptyTitle: 'MongoDB metadata is not available',
  emptyDescription: 'Refresh this object or verify that the connected user has permission to inspect this metadata.',
}

export function getMongoObjectViewDescriptor(kind: string | undefined): MongoObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[kind] ?? DEFAULT_DESCRIPTOR
}

export function mongoObjectViewMenuLabel(kind: string | undefined): string {
  return getMongoObjectViewDescriptor(kind).menuLabel
}

export function mongoScopedQueryMenuLabel(kind: string | undefined): string {
  if (kind === 'collection' || kind === 'documents' || kind === 'gridfs-collection') {
    return 'Open Documents'
  }

  if (kind === 'aggregations') {
    return 'Open Aggregation Builder'
  }

  if (kind === 'pipeline' || kind === 'sample-results' || kind === 'view') {
    return 'Open Sample Results'
  }

  if (kind?.startsWith('gridfs')) {
    return 'Query GridFS Collection'
  }

  return 'Open Query'
}

export const MONGO_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))
