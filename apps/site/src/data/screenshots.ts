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
    image: '/screenshots/hero-workbench.png',
  },
  'connection-wizard': {
    id: 'connection-wizard',
    title: 'Connection wizard',
    caption: 'Connection profile fields, read-only settings, and test result.',
    image: '/screenshots/connection-wizard.png',
  },
  'library-environments': {
    id: 'library-environments',
    title: 'Library and environments',
    caption: 'Saved connections, folders, scripts, and inherited environment labels.',
    image: '/screenshots/library-environments.png',
  },
  'explorer-tree': {
    id: 'explorer-tree',
    title: 'Object explorer',
    caption: 'Datastore-owned tree with native objects and context actions.',
    image: '/screenshots/explorer-tree.png',
  },
  'sql-query-results': {
    id: 'sql-query-results',
    title: 'SQL query results',
    caption: 'Editor, result grid, messages, and row selection in one workspace.',
    image: '/screenshots/sql-query-results.png',
  },
  'mongodb-builder': {
    id: 'mongodb-builder',
    title: 'MongoDB query builder',
    caption: 'Filters, projections, sort, explain plans, and document results.',
    image: '/screenshots/mongodb-builder.png',
  },
  'redis-browser': {
    id: 'redis-browser',
    title: 'Redis key browser',
    caption: 'Key filters, type-aware value surfaces, TTL, and guarded key actions.',
    image: '/screenshots/redis-browser.png',
  },
  'search-diagnostics': {
    id: 'search-diagnostics',
    title: 'Search diagnostics',
    caption: 'Index, mapping, profile, shard, and slow-log inspection surfaces.',
    image: '/screenshots/search-diagnostics.png',
  },
  'import-export': {
    id: 'import-export',
    title: 'Import and export',
    caption: 'Guarded file workflows for tables, collections, keys, and local files.',
    image: '/screenshots/import-export.png',
  },
  'result-export': {
    id: 'result-export',
    title: 'Result export dialog',
    caption: 'Payload-aware CSV, JSON, NDJSON, and text exports with secret redaction.',
    image: '/screenshots/result-export.png',
  },
  'settings-backups': {
    id: 'settings-backups',
    title: 'Settings and backups',
    caption: 'Workspace bundles, encrypted backups, appearance, health, and shortcuts.',
    image: '/screenshots/settings-backups.png',
  },
  'download-release': {
    id: 'download-release',
    title: 'Platform download',
    caption: 'Release card recommending the best installer for the visitor platform.',
    image: '/screenshots/download-release.png',
  },
  'safety-preview': {
    id: 'safety-preview',
    title: 'Guarded preview',
    caption: 'A destructive or administrative action shown as a reviewable plan first.',
    image: '/screenshots/safety-preview.png',
  },
  'api-server': {
    id: 'api-server',
    title: 'API Server workspace',
    caption: 'Local REST, GraphQL, or gRPC servers exposing selected datastore resources and saved queries.',
    image: '/screenshots/api-server.png',
  },
  'mcp-server': {
    id: 'mcp-server',
    title: 'MCP Server setup',
    caption: 'Desktop-only MCP endpoints, scoped auth tokens, client snippets, metrics, and logs.',
    image: '/screenshots/mcp-server.png',
  },
  'workspace-search': {
    id: 'workspace-search',
    title: 'Workspace Search',
    caption: 'Search connections, Library work, open tabs, recently closed tabs, scripts, and tests.',
    image: '/screenshots/workspace-search.png',
  },
  'test-suites': {
    id: 'test-suites',
    title: 'Datastore test suites',
    caption: 'Visual and raw JSON editors for setup, execute, assert, and teardown cases.',
    image: '/screenshots/test-suites.png',
  },
  'relationship-explorer': {
    id: 'relationship-explorer',
    title: 'SQL relationship explorer',
    caption: 'Focused schema diagrams with table cards, relationship ends, and object inspectors.',
    image: '/screenshots/relationship-explorer.png',
  },
}

export function getScreenshotSlot(id: ScreenshotId) {
  return screenshotSlots[id]
}
