export type SqliteObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, SqliteObjectViewDescriptor> = {
  database: descriptor('database', 'Open Database Overview', 'SQLite Database', 'Review the main database file, attached databases, schema objects, PRAGMA health, and storage hints.', 'No SQLite database metadata is loaded', 'Refresh the database to collect sqlite_schema and PRAGMA metadata.'),
  'attached-databases': descriptor('attached-databases', 'Open Attached Databases', 'Attached Databases', 'Review database files attached to this SQLite connection.', 'No attached databases were returned', 'This connection may only have the main database attached.'),
  tables: descriptor('tables', 'Open Tables', 'SQLite Tables', 'Review base row-store tables, row counts, schema SQL summaries, and table entry points.', 'No tables were returned', 'The database may not contain user tables.'),
  table: descriptor('table', 'Open Table', 'SQLite Table', 'Inspect columns, indexes, constraints, triggers, foreign keys, statistics, DDL, and a bounded data query.', 'No table metadata is loaded', 'Refresh this table to collect PRAGMA table metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'SQLite Views', 'Review stored SELECT definitions and open bounded view queries.', 'No views were returned', 'The database may not contain views.'),
  view: descriptor('view', 'Open View Definition', 'SQLite View', 'Inspect view columns, definition summary, dependencies, and a bounded query.', 'No view metadata is loaded', 'Refresh this view to collect sqlite_schema metadata.', 'Open View Query'),
  indexes: descriptor('indexes', 'Manage Indexes', 'SQLite Indexes', 'Review standalone and table indexes, uniqueness, origin, partial state, and indexed columns.', 'No indexes were returned', 'Refresh indexes or check sqlite_schema metadata.'),
  index: descriptor('index', 'Open Index', 'SQLite Index', 'Inspect indexed columns, uniqueness, origin, partial state, and definition summary.', 'No index metadata is loaded', 'Refresh this index to collect PRAGMA index metadata.'),
  triggers: descriptor('triggers', 'Open Triggers', 'SQLite Triggers', 'Review table and database triggers with event/timing summaries.', 'No triggers were returned', 'This database may not define triggers.'),
  trigger: descriptor('trigger', 'Open Trigger', 'SQLite Trigger', 'Inspect trigger timing, event, table target, and definition summary.', 'No trigger metadata is loaded', 'Refresh this trigger to collect sqlite_schema metadata.'),
  columns: descriptor('columns', 'Open Columns', 'SQLite Columns', 'Review declared columns, affinity, nullability, defaults, generated/hidden flags, and primary key order.', 'No columns were returned', 'Refresh columns to collect PRAGMA table_xinfo metadata.'),
  constraints: descriptor('constraints', 'Open Constraints', 'SQLite Constraints', 'Review primary key, not-null, default, check, unique, and foreign-key constraint surfaces.', 'No constraints were returned', 'This table may not define explicit constraints.'),
  'foreign-keys': descriptor('foreign-keys', 'Open Foreign Keys', 'SQLite Foreign Keys', 'Review referenced tables, columns, update/delete actions, and deferred state.', 'No foreign keys were returned', 'Foreign keys may be disabled or this table may not reference other tables.'),
  statistics: descriptor('statistics', 'Open Statistics', 'SQLite Statistics', 'Review row count, page count, page size, freelist, and quick-check status.', 'No statistics are loaded', 'Refresh statistics to collect lightweight PRAGMA signals.'),
  data: descriptor('data', 'Open Data', 'SQLite Data', 'Open a bounded row query for this table or view.', 'No data query is configured', 'Open the object query from the tree to browse rows.', 'Open Data Query'),
  ddl: descriptor('ddl', 'Open DDL', 'SQLite DDL', 'Review CREATE statement summaries for the selected object.', 'No DDL metadata is loaded', 'Refresh DDL to collect sqlite_schema SQL.'),
  pragmas: descriptor('pragmas', 'Open Pragmas', 'SQLite Pragmas', 'Review SQLite PRAGMA settings, integrity checks, journaling, synchronous mode, and database attachments.', 'No PRAGMA metadata is loaded', 'Refresh PRAGMAs to collect database settings.'),
  pragma: descriptor('pragma', 'Open Pragma', 'SQLite Pragma', 'Inspect a specific SQLite PRAGMA result in a table-friendly form.', 'No PRAGMA result was returned', 'Refresh this PRAGMA or check SQLite support for the current database.'),
  schema: descriptor('schema', 'Open Schema', 'SQLite Schema', 'Review sqlite_schema objects without showing raw CREATE statements by default.', 'No schema rows were returned', 'Refresh schema metadata to inspect tables, views, indexes, and triggers.'),
  'virtual-tables': descriptor('virtual-tables', 'Open Virtual Tables', 'SQLite Virtual Tables', 'Review extension-backed virtual tables and their modules.', 'No virtual tables were returned', 'This database may not use SQLite virtual table modules.'),
  'fts-tables': descriptor('fts-tables', 'Open FTS Tables', 'SQLite FTS Tables', 'Review full-text search virtual tables and tokenizer/module hints.', 'No FTS tables were returned', 'This database may not use FTS virtual tables.'),
  'rtree-tables': descriptor('rtree-tables', 'Open RTree Tables', 'SQLite RTree Tables', 'Review spatial RTree virtual tables and geometry index surfaces.', 'No RTree tables were returned', 'This database may not use RTree virtual tables.'),
  'generated-columns': descriptor('generated-columns', 'Open Generated Columns', 'Generated Columns', 'Review generated and hidden columns surfaced through PRAGMA table_xinfo.', 'No generated columns were returned', 'This database may not define generated columns.'),
}

const DEFAULT_DESCRIPTOR: SqliteObjectViewDescriptor = descriptor(
  'object',
  'Inspect SQLite Object',
  'SQLite Object',
  'Review available SQLite metadata for this object.',
  'SQLite metadata is not available',
  'Refresh this object or check whether the file can be inspected.',
)

export function getSqliteObjectViewDescriptor(kind: string | undefined): SqliteObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeSqliteObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function sqliteObjectViewMenuLabel(kind: string | undefined): string {
  return getSqliteObjectViewDescriptor(kind).menuLabel
}

export function isSqliteObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeSqliteObjectKind(kind)])
}

export const SQLITE_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): SqliteObjectViewDescriptor {
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

function normalizeSqliteObjectKind(kind: string) {
  const normalized = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (['base-table', 'strict-table', 'virtual-table', 'fts-table', 'rtree-table'].includes(normalized)) {
    return 'table'
  }

  return normalized
}
