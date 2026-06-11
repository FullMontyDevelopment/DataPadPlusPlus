export type DuckDbObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, DuckDbObjectViewDescriptor> = {
  database: descriptor('database', 'Open Database Overview', 'DuckDB Database', 'Review the local DuckDB file, attached databases, tables, views, extensions, files, and PRAGMA health.', 'No DuckDB metadata is loaded', 'Refresh the database or verify the DuckDB file can be opened.'),
  schemas: descriptor('schemas', 'Browse Schemas', 'DuckDB Schemas', 'Review attached schemas and object counts across the DuckDB catalog.', 'No schemas are loaded', 'Refresh metadata or attach a database.'),
  schema: descriptor('schema', 'Open Schema', 'DuckDB Schema', 'Inspect tables, views, macros, functions, and grants in one DuckDB schema.', 'Schema metadata is not loaded', 'Refresh this schema to collect catalog metadata.'),
  tables: descriptor('tables', 'Open Tables', 'DuckDB Tables', 'Review analytical tables, row estimates, storage shape, and query entry points.', 'No tables were returned', 'This DuckDB file may not contain user tables.'),
  table: descriptor('table', 'Open Table', 'DuckDB Table', 'Inspect columns, indexes, constraints, statistics, storage hints, and a bounded data query.', 'Table metadata is not loaded', 'Refresh this table to collect DuckDB catalog metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'DuckDB Views', 'Review stored SELECT projections and open bounded view queries.', 'No views were returned', 'This DuckDB file may not contain views.'),
  view: descriptor('view', 'Open DuckDB View', 'DuckDB View', 'Inspect view columns, dependencies, definition summary, and a bounded query.', 'View metadata is not loaded', 'Refresh this view to collect catalog metadata.', 'Open View Query'),
  indexes: descriptor('indexes', 'Manage Indexes', 'DuckDB Indexes', 'Review DuckDB indexes, indexed columns, uniqueness, and guarded maintenance previews.', 'No indexes were returned', 'Refresh indexes or check whether this file defines secondary indexes.'),
  index: descriptor('index', 'Open Index', 'DuckDB Index', 'Inspect indexed columns, uniqueness, and object coverage.', 'Index metadata is not loaded', 'Refresh this index.'),
  extensions: descriptor('extensions', 'Manage Extensions', 'DuckDB Extensions', 'Review installed and loadable extensions such as parquet, httpfs, spatial, and json.', 'No extensions are loaded', 'Refresh extension metadata or install/load extensions through guarded previews.'),
  extension: descriptor('extension', 'Open Extension', 'DuckDB Extension', 'Inspect one extension, install/load state, repository source, and capability notes.', 'Extension metadata is not loaded', 'Refresh this extension.'),
  'attached-databases': descriptor('attached-databases', 'Open Attached Databases', 'Attached Databases', 'Review attached DuckDB databases, aliases, file paths, and read-only state.', 'No attached databases were returned', 'This connection may only have the main database attached.'),
  files: descriptor('files', 'Review Files', 'External Files', 'Review parquet/csv/json file sources, glob shape, schemas, and import/export readiness.', 'No external file metadata is loaded', 'Use a table function or import workflow to register external files.'),
  pragmas: descriptor('pragmas', 'Open Pragmas', 'DuckDB Pragmas', 'Review DuckDB settings, memory limits, threads, extension policy, and storage checks.', 'No PRAGMA metadata is loaded', 'Refresh PRAGMAs to collect DuckDB settings.'),
  pragma: descriptor('pragma', 'Open Pragma', 'DuckDB Pragma', 'Inspect one DuckDB PRAGMA result in a table-friendly view.', 'No PRAGMA result was returned', 'Refresh this PRAGMA.'),
  functions: descriptor('functions', 'Open Functions', 'DuckDB Functions', 'Review scalar/table functions, macros, arguments, and extension ownership.', 'No functions were returned', 'Refresh functions or load the relevant extension.'),
  function: descriptor('function', 'Open Function', 'DuckDB Function', 'Inspect one DuckDB function or macro signature, return type, and extension source.', 'Function metadata is not loaded', 'Refresh this function.'),
  statistics: descriptor('statistics', 'Open Statistics', 'DuckDB Statistics', 'Review row estimates, column stats, compression, and storage hints.', 'No statistics are loaded', 'Refresh statistics metadata.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'DuckDB Diagnostics', 'Review memory, threads, storage, extension, and query-risk signals for the local database.', 'No diagnostics are loaded', 'Refresh diagnostics metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect DuckDB Object',
  'DuckDB Object',
  'Review available DuckDB metadata for this object.',
  'DuckDB metadata is not available',
  'Refresh this object or check whether the file can be inspected.',
)

export function getDuckDbObjectViewDescriptor(kind: string | undefined): DuckDbObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeDuckDbObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function duckDbObjectViewMenuLabel(kind: string | undefined): string {
  return getDuckDbObjectViewDescriptor(kind).menuLabel
}

export function isDuckDbObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeDuckDbObjectKind(kind)])
}

export const DUCKDB_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): DuckDbObjectViewDescriptor {
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

function normalizeDuckDbObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
