export type ScreenshotId =
  | 'hero-workbench'
  | 'connection-wizard'
  | 'library-environments'
  | 'explorer-tree'
  | 'sql-query-results'
  | 'mongodb-builder'
  | 'redis-browser'
  | 'search-diagnostics'
  | 'import-export'
  | 'result-export'
  | 'settings-backups'
  | 'download-release'
  | 'safety-preview'
  | 'api-server'
  | 'mcp-server'
  | 'workspace-search'
  | 'test-suites'
  | 'relationship-explorer'

export type ScreenshotSlot = {
  id: ScreenshotId
  title: string
  caption: string
  image?: string
}

export const screenshotSlots: Record<ScreenshotId, ScreenshotSlot> = {
  'hero-workbench': {
    id: 'hero-workbench',
    title: 'Workbench overview',
    caption: 'Hero image showing the full DataPad++ desktop workspace.',
  },
  'connection-wizard': {
    id: 'connection-wizard',
    title: 'Connection wizard',
    caption: 'Connection profile fields, read-only settings, and test result.',
  },
  'library-environments': {
    id: 'library-environments',
    title: 'Library and environments',
    caption: 'Saved connections, folders, scripts, and inherited environment labels.',
  },
  'explorer-tree': {
    id: 'explorer-tree',
    title: 'Object explorer',
    caption: 'Datastore-owned tree with native objects and context actions.',
  },
  'sql-query-results': {
    id: 'sql-query-results',
    title: 'SQL query results',
    caption: 'Editor, result grid, messages, and row selection in one workspace.',
  },
  'mongodb-builder': {
    id: 'mongodb-builder',
    title: 'MongoDB query builder',
    caption: 'Filters, projections, sort, explain plans, and document results.',
  },
  'redis-browser': {
    id: 'redis-browser',
    title: 'Redis key browser',
    caption: 'Key filters, type-aware value surfaces, TTL, and guarded key actions.',
  },
  'search-diagnostics': {
    id: 'search-diagnostics',
    title: 'Search diagnostics',
    caption: 'Index, mapping, profile, shard, and slow-log inspection surfaces.',
  },
  'import-export': {
    id: 'import-export',
    title: 'Import and export',
    caption: 'Guarded file workflows for tables, collections, keys, and local files.',
  },
  'result-export': {
    id: 'result-export',
    title: 'Result export dialog',
    caption: 'Payload-aware CSV, JSON, NDJSON, and text exports with secret redaction.',
  },
  'settings-backups': {
    id: 'settings-backups',
    title: 'Settings and backups',
    caption: 'Workspace bundles, encrypted backups, appearance, health, and shortcuts.',
  },
  'download-release': {
    id: 'download-release',
    title: 'Platform download',
    caption: 'Release card recommending the best installer for the visitor platform.',
  },
  'safety-preview': {
    id: 'safety-preview',
    title: 'Guarded preview',
    caption: 'A destructive or administrative action shown as a reviewable plan first.',
  },
  'api-server': {
    id: 'api-server',
    title: 'API Server workspace',
    caption: 'Local REST, GraphQL, or gRPC servers exposing selected datastore resources and saved queries.',
  },
  'mcp-server': {
    id: 'mcp-server',
    title: 'MCP Server setup',
    caption: 'Desktop-only MCP endpoints, scoped auth tokens, client snippets, metrics, and logs.',
  },
  'workspace-search': {
    id: 'workspace-search',
    title: 'Workspace Search',
    caption: 'Search connections, Library work, open tabs, recently closed tabs, scripts, and tests.',
  },
  'test-suites': {
    id: 'test-suites',
    title: 'Datastore test suites',
    caption: 'Visual and raw JSON editors for setup, execute, assert, and teardown cases.',
  },
  'relationship-explorer': {
    id: 'relationship-explorer',
    title: 'SQL relationship explorer',
    caption: 'Focused schema diagrams with table cards, relationship ends, and object inspectors.',
  },
}

export function getScreenshotSlot(id: ScreenshotId) {
  return screenshotSlots[id]
}
