export type LiteDbObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, LiteDbObjectViewDescriptor> = {
  database: descriptor('database', 'Open Database Overview', 'LiteDB Database', 'Review the local database file, collections, indexes, file storage, storage health, and maintenance actions.', 'No LiteDB database metadata is loaded', 'Refresh the database or verify the local file path is accessible.'),
  collections: descriptor('collections', 'Browse Collections', 'LiteDB Collections', 'Review document collections, counts, indexes, inferred fields, and query entry points.', 'No collections are loaded', 'This LiteDB file may not contain user collections yet.'),
  collection: descriptor('collection', 'Open Collection', 'LiteDB Collection', 'Inspect documents, inferred schema, indexes, storage footprint, and safe collection workflows.', 'Collection metadata is not loaded', 'Refresh this collection or check that it still exists.', 'Open Collection Query'),
  documents: descriptor('documents', 'Open Documents', 'LiteDB Documents', 'Open a bounded document query for this collection.', 'No document query is configured', 'Open the collection query to browse documents.', 'Open Documents'),
  schema: descriptor('schema', 'Open Schema Preview', 'LiteDB Schema Preview', 'Review inferred field paths, BSON-like value types, presence, examples, and mixed-type warnings.', 'No schema sample is loaded', 'Refresh schema preview after loading documents.'),
  indexes: descriptor('indexes', 'Manage Indexes', 'LiteDB Indexes', 'Review collection indexes, uniqueness, expressions, usage hints, and guarded create/drop previews.', 'No indexes are loaded', 'Refresh indexes or create the first collection index.'),
  index: descriptor('index', 'Open Index', 'LiteDB Index', 'Inspect one LiteDB index, expression, uniqueness, and target collection.', 'Index metadata is not loaded', 'Refresh this index.'),
  'file-storage': descriptor('file-storage', 'Browse File Storage', 'LiteDB File Storage', 'Review stored files, chunks, metadata, and export/import entry points.', 'No files are loaded', 'This database may not use LiteDB file storage.'),
  files: descriptor('files', 'Open Files', 'LiteDB Files', 'Review file metadata, IDs, filenames, sizes, upload dates, and chunk health.', 'No files are loaded', 'File storage may be empty.'),
  chunks: descriptor('chunks', 'Open Chunks', 'LiteDB Chunks', 'Review file chunk distribution and missing-chunk warnings.', 'No chunks are loaded', 'No file chunks were returned.'),
  storage: descriptor('storage', 'Open Storage Health', 'LiteDB Storage', 'Review page allocation, free pages, file size, checkpoint needs, and rebuild guidance.', 'No storage metadata is loaded', 'Refresh storage metadata for this local file.'),
  statistics: descriptor('statistics', 'Open Statistics', 'LiteDB Statistics', 'Review collection counts, index coverage, average document size, and storage signals.', 'No statistics are loaded', 'Refresh collection statistics.'),
  pragmas: descriptor('pragmas', 'Open Pragmas', 'LiteDB Pragmas', 'Review LiteDB file pragmas and connection-level runtime options.', 'No pragmas are loaded', 'Refresh database pragmas.'),
  maintenance: descriptor('maintenance', 'Open Maintenance', 'LiteDB Maintenance', 'Review checkpoint, compact, rebuild, and backup workflows.', 'No maintenance workflows are loaded', 'Refresh maintenance guidance.'),
  settings: descriptor('settings', 'Open Settings', 'LiteDB Settings', 'Review connection mode, encryption state, journal/checkpoint posture, and local file options.', 'No settings are loaded', 'Refresh database settings.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'LiteDB Diagnostics', 'Review file health, index coverage, storage pressure, collection counts, and maintenance warnings.', 'No diagnostics are loaded', 'Refresh diagnostics for this LiteDB file.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect LiteDB Object',
  'LiteDB Object',
  'Review available LiteDB metadata for this object.',
  'LiteDB metadata is not available',
  'Refresh this object or check whether the local file can be inspected.',
)

export function getLiteDbObjectViewDescriptor(kind: string | undefined): LiteDbObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeLiteDbObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function liteDbObjectViewMenuLabel(kind: string | undefined): string {
  return getLiteDbObjectViewDescriptor(kind).menuLabel
}

export function isLiteDbObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeLiteDbObjectKind(kind)])
}

export const LITEDB_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): LiteDbObjectViewDescriptor {
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

function normalizeLiteDbObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
