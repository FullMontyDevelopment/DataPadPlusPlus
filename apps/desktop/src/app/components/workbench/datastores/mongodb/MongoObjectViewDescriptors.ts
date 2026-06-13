export type MongoObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
  primaryActions: string[]
}

const DESCRIPTORS: Record<string, MongoObjectViewDescriptor> = {
  databases: {
    kind: 'databases',
    menuLabel: 'Open Databases',
    title: 'Databases',
    purpose: 'Review MongoDB databases and prepare database creation from a first collection.',
    primaryActions: ['Review databases', 'Create database'],
    emptyTitle: 'No database metadata is loaded yet',
    emptyDescription: 'Refresh the database list to inspect available MongoDB databases.',
  },
  'system-databases': {
    kind: 'system-databases',
    menuLabel: 'Open System Databases',
    title: 'System Databases',
    purpose: 'Review MongoDB system databases without exposing destructive database actions.',
    primaryActions: ['Review system databases'],
    emptyTitle: 'No system database metadata is loaded yet',
    emptyDescription: 'Refresh the system database list to inspect admin, config, and local databases.',
  },
  database: {
    kind: 'database',
    menuLabel: 'Open Database Overview',
    title: 'Database Overview',
    purpose: 'Review the database structure, security surfaces, GridFS areas, and statistics before opening a focused MongoDB workflow.',
    primaryActions: ['Browse collections', 'Review users and roles', 'Open database statistics'],
    emptyTitle: 'Database metadata is not loaded yet',
    emptyDescription: 'Refresh the view to collect collections, views, security, GridFS, and statistics metadata for this database.',
  },
  collection: {
    kind: 'collection',
    menuLabel: 'Open Collection Overview',
    title: 'Collection Overview',
    purpose: 'Work with documents, schema, indexes, validation rules, statistics, permissions, and collection management.',
    primaryActions: ['Open documents', 'Insert document', 'Manage indexes', 'Manage validation'],
    emptyTitle: 'Collection metadata is not loaded yet',
    emptyDescription: 'Refresh the collection view or open Documents to inspect data and collect richer collection details.',
    primaryQueryLabel: 'Open Documents',
  },
  'insert-document': {
    kind: 'insert-document',
    menuLabel: 'Add Document',
    title: 'Add Document',
    purpose: 'Create one JSON document for this collection with local validation before the guarded insert runs.',
    primaryActions: ['Load JSON', 'Validate', 'Insert'],
    emptyTitle: 'Select a collection before inserting',
    emptyDescription: 'Open Add Document from a MongoDB collection so DataPad++ can validate against the target scope.',
  },
  'create-index': {
    kind: 'create-index',
    menuLabel: 'Create Index',
    title: 'Create Index',
    purpose: 'Define a key pattern and options for a MongoDB index create plan.',
    primaryActions: ['Define key', 'Validate JSON', 'Review'],
    emptyTitle: 'Select a collection before creating an index',
    emptyDescription: 'Open Create Index from a MongoDB collection or Indexes folder so DataPad++ can scope the plan.',
  },
  view: {
    kind: 'view',
    menuLabel: 'Inspect View Definition',
    title: 'MongoDB View',
    purpose: 'Inspect the backing pipeline, dependencies, and a bounded results preview for this read-only MongoDB view.',
    primaryActions: ['Review pipeline', 'Open results preview'],
    emptyTitle: 'View metadata is not loaded yet',
    emptyDescription: 'Refresh the view to collect its backing pipeline and dependency metadata.',
    primaryQueryLabel: 'Open Results Preview',
  },
  'schema-preview': {
    kind: 'schema-preview',
    menuLabel: 'Open Schema Preview',
    title: 'Schema Preview',
    purpose: 'Understand document shape from bounded samples: field presence, BSON types, examples, mixed-type fields, and validator opportunities.',
    primaryActions: ['Review fields', 'Find mixed types', 'Prepare validator'],
    emptyTitle: 'No schema sample is available',
    emptyDescription: 'Run or refresh schema sampling after the collection has documents. DataPad++ keeps this bounded so large collections stay safe.',
  },
  indexes: {
    kind: 'indexes',
    menuLabel: 'Manage Indexes',
    title: 'Index Manager',
    purpose: 'Review collection access paths, options, usage hints, and index changes.',
    primaryActions: ['Review indexes', 'Create index', 'Drop index'],
    emptyTitle: 'No index metadata is available',
    emptyDescription: 'Refresh indexes or verify that the connected user can run listIndexes for this collection.',
  },
  'search-indexes': {
    kind: 'search-indexes',
    menuLabel: 'Manage Search Indexes',
    title: 'Search Indexes',
    purpose: 'Manage Atlas Search indexes when this deployment exposes them.',
    primaryActions: ['Review search indexes'],
    emptyTitle: 'Search index metadata is unavailable',
    emptyDescription: 'This deployment did not expose Atlas Search index metadata through the connected MongoDB APIs.',
  },
  'vector-indexes': {
    kind: 'vector-indexes',
    menuLabel: 'Manage Vector Indexes',
    title: 'Vector Indexes',
    purpose: 'Manage vector search indexes when this deployment exposes them.',
    primaryActions: ['Review vector indexes'],
    emptyTitle: 'Vector index metadata is unavailable',
    emptyDescription: 'This deployment did not expose vector index metadata through the connected MongoDB APIs.',
  },
  'validation-rules': {
    kind: 'validation-rules',
    menuLabel: 'Manage Validation Rules',
    title: 'Validation Rules',
    purpose: 'Inspect the active validator, test draft documents, and review validator updates.',
    primaryActions: ['Review validator', 'Test document', 'Prepare update'],
    emptyTitle: 'No validator is configured',
    emptyDescription: 'This collection currently accepts documents without a collection validator. You can draft one here and apply it through guardrails.',
  },
  'collection-statistics': {
    kind: 'collection-statistics',
    menuLabel: 'Open Collection Statistics',
    title: 'Collection Statistics',
    purpose: 'Measure collection size, document counts, average object size, storage, and index footprint in a compact diagnostics view.',
    primaryActions: ['Review size', 'Review index footprint'],
    emptyTitle: 'No collection statistics were returned',
    emptyDescription: 'Refresh statistics or verify that the connected user can inspect collection statistics.',
  },
  'database-statistics': {
    kind: 'database-statistics',
    menuLabel: 'Open Database Statistics',
    title: 'Database Statistics',
    purpose: 'Measure database-level storage, object counts, collection counts, and index footprint in a compact diagnostics view.',
    primaryActions: ['Review storage', 'Review object counts'],
    emptyTitle: 'No database statistics were returned',
    emptyDescription: 'Refresh statistics or verify that the connected user can inspect database statistics.',
  },
  permissions: {
    kind: 'permissions',
    menuLabel: 'Open Permissions',
    title: 'Permissions',
    purpose: 'Review permission-related metadata for the selected collection or database and surface unavailable privilege details clearly.',
    primaryActions: ['Review permissions', 'Open warning details'],
    emptyTitle: 'No permission metadata was returned',
    emptyDescription: 'The connected user may not be allowed to inspect permissions for this scope.',
  },
  scripts: {
    kind: 'scripts',
    menuLabel: 'Open Scripts',
    title: 'Scripts',
    purpose: 'Start MongoDB scripting workflows and reusable operation templates scoped to this object.',
    primaryActions: ['Open scripting', 'Review templates'],
    emptyTitle: 'No script templates are available',
    emptyDescription: 'Open the scripting workspace to create a scoped script for this MongoDB object.',
    primaryQueryLabel: 'Open Scripting',
  },
  aggregations: {
    kind: 'aggregations',
    menuLabel: 'Open Aggregation Builder',
    title: 'Aggregation Builder',
    purpose: 'Build and run aggregation pipelines scoped to this collection while keeping the pipeline editable.',
    primaryActions: ['Open aggregation builder', 'Review pipeline templates'],
    emptyTitle: 'No aggregation templates are available',
    emptyDescription: 'Open the aggregation builder to start a scoped pipeline for this collection.',
    primaryQueryLabel: 'Open Aggregation Builder',
  },
  pipeline: {
    kind: 'pipeline',
    menuLabel: 'Open Pipeline',
    title: 'View Pipeline',
    purpose: 'Inspect the pipeline that defines this MongoDB view and open a bounded results preview from the same scope.',
    primaryActions: ['Review pipeline', 'Open results preview'],
    emptyTitle: 'No pipeline was returned',
    emptyDescription: 'Refresh the view or verify that listCollections returned pipeline metadata for this view.',
    primaryQueryLabel: 'Open Results Preview',
  },
  gridfs: {
    kind: 'gridfs',
    menuLabel: 'Browse GridFS',
    title: 'GridFS Browser',
    purpose: 'Browse GridFS buckets, files, chunks, metadata, and query/export entry points for file-backed collections.',
    primaryActions: ['Browse buckets', 'Query files', 'Query chunks'],
    emptyTitle: 'No GridFS metadata is loaded',
    emptyDescription: 'Refresh GridFS metadata to list buckets, file metadata collections, and chunk collections.',
  },
  'gridfs-buckets': {
    kind: 'gridfs-buckets',
    menuLabel: 'Browse GridFS Buckets',
    title: 'GridFS Buckets',
    purpose: 'List GridFS bucket prefixes and jump into their files and chunks collections.',
    primaryActions: ['Review buckets', 'Open bucket files'],
    emptyTitle: 'No GridFS buckets were found',
    emptyDescription: 'This database may not contain GridFS bucket collections, or the connected user may not be allowed to list them.',
  },
  'gridfs-bucket': {
    kind: 'gridfs-bucket',
    menuLabel: 'Open GridFS Bucket',
    title: 'GridFS Bucket',
    purpose: 'Inspect a GridFS bucket and open its files or chunks collections as focused document queries.',
    primaryActions: ['Open files collection', 'Open chunks collection'],
    emptyTitle: 'GridFS bucket metadata is not loaded',
    emptyDescription: 'Refresh the bucket metadata or query the bucket backing collections directly.',
  },
  'gridfs-files': {
    kind: 'gridfs-files',
    menuLabel: 'Open GridFS Files',
    title: 'GridFS Browser',
    purpose: 'Inspect GridFS file metadata, upload dates, custom metadata, and query/export entry points.',
    primaryActions: ['Review file metadata', 'Query files collection', 'Export files'],
    emptyTitle: 'No GridFS files were returned',
    emptyDescription: 'Refresh GridFS metadata or verify that this bucket has an fs.files collection.',
    primaryQueryLabel: 'Query GridFS Collection',
  },
  'gridfs-chunks': {
    kind: 'gridfs-chunks',
    menuLabel: 'Open GridFS Chunks',
    title: 'GridFS Browser',
    purpose: 'Inspect GridFS chunk metadata and identify missing or mismatched chunks before exporting files.',
    primaryActions: ['Review chunks', 'Check chunk health', 'Query chunks collection'],
    emptyTitle: 'No GridFS chunks were returned',
    emptyDescription: 'Refresh GridFS metadata or verify that this bucket has an fs.chunks collection.',
    primaryQueryLabel: 'Query GridFS Collection',
  },
  users: {
    kind: 'users',
    menuLabel: 'Manage Users',
    title: 'Users',
    purpose: 'Review database users, assigned roles, authentication details, and user management changes.',
    primaryActions: ['Review users', 'Create user', 'Drop user'],
    emptyTitle: 'No users were returned',
    emptyDescription: 'The connected user may not have usersInfo privileges, or this database has no user records available to this login.',
  },
  roles: {
    kind: 'roles',
    menuLabel: 'Manage Roles',
    title: 'Roles',
    purpose: 'Review role inheritance, privileges, and role management changes.',
    primaryActions: ['Review roles', 'Create role', 'Drop role'],
    emptyTitle: 'No roles were returned',
    emptyDescription: 'The connected user may not have rolesInfo privileges, or this database has no role records available to this login.',
  },
}

const DEFAULT_DESCRIPTOR: MongoObjectViewDescriptor = {
  kind: 'object',
  menuLabel: 'Inspect Mongo Metadata',
  title: 'Mongo Metadata',
  purpose: 'Inspect MongoDB metadata for this object with available warnings and query handoffs.',
  primaryActions: ['Inspect metadata'],
  emptyTitle: 'MongoDB metadata is not available',
  emptyDescription: 'Refresh this object or verify that the connected user has permission to inspect this metadata.',
}

const LEGACY_KIND_ALIASES: Record<string, string> = {
  'sample-results': 'view-results',
}

function normalizeMongoDescriptorKind(kind: string) {
  return LEGACY_KIND_ALIASES[kind] ?? kind
}

export function getMongoObjectViewDescriptor(kind: string | undefined): MongoObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeMongoDescriptorKind(kind)] ?? DEFAULT_DESCRIPTOR
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

  if (kind === 'pipeline' || kind === 'view-results' || kind === 'sample-results' || kind === 'view') {
    return 'Open Results Preview'
  }

  if (kind === 'gridfs-files' || kind === 'gridfs-chunks') {
    return 'Query GridFS Collection'
  }

  return 'Open Query'
}

export const MONGO_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

export const MONGO_QUERYABLE_OBJECT_KINDS = Object.freeze([
  'collection',
  'documents',
  'aggregations',
  'view-results',
  'view',
  'pipeline',
  'gridfs-collection',
  'gridfs-files',
  'gridfs-chunks',
])

export function isMongoObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && MONGO_OBJECT_VIEW_KINDS.includes(normalizeMongoDescriptorKind(kind)))
}

export function isMongoQueryableObjectKind(kind: string | undefined): boolean {
  return Boolean(kind && MONGO_QUERYABLE_OBJECT_KINDS.includes(normalizeMongoDescriptorKind(kind)))
}
