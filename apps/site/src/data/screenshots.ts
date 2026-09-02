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
  | 'typed-query-builder'
  | 'document-editor'
  | 'key-value-inspector'
  | 'datastore-transfer'
  | 'transfer-center'
  | 'workspace-import-review'
  | 'multi-window-tabs'
  | 'oracle-paging'

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
    title: 'Guarded document edit',
    caption: 'A document field change paused for environment-aware review before execution.',
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
    caption: 'Opt-in visual suites with owned cases, removable steps, focused assertions, and adapter-backed preflight execution.',
    image: '/screenshots/test-suites.png',
  },
  'relationship-explorer': {
    id: 'relationship-explorer',
    title: 'SQL relationship explorer',
    caption: 'Focused schema diagrams with table cards, relationship ends, and object inspectors.',
    image: '/screenshots/relationship-explorer.png',
  },
  'typed-query-builder': {
    id: 'typed-query-builder',
    title: 'Typed query builder values',
    caption: 'A Date/time filter using a timezone-aware ISO value and the compact native picker before query execution.',
    image: '/screenshots/typed-query-builder.png',
  },
  'document-editor': {
    id: 'document-editor',
    title: 'Guarded document field editing',
    caption: 'A field-level document change paused for target and environment review before execution.',
    image: '/screenshots/import-export.png',
  },
  'key-value-inspector': {
    id: 'key-value-inspector',
    title: 'Complete key-value inspector',
    caption: 'Authoritative full-value content with inline type and size badges, source formatting, copy, and guarded edit actions.',
    image: '/screenshots/redis-browser.png',
  },
  'datastore-transfer': {
    id: 'datastore-transfer',
    title: 'Native datastore transfer',
    caption: 'Selected objects, native or portable formats, destination options, validation, and conflict-safe review.',
  },
  'transfer-center': {
    id: 'transfer-center',
    title: 'Transfers Center',
    caption: 'Background progress, warnings, cancellation, retry state, native job identifiers, and completed artifacts.',
  },
  'workspace-import-review': {
    id: 'workspace-import-review',
    title: 'File-first workspace import',
    caption: 'A staged choose-file, unlock, and review workflow that keeps encrypted contents closed until the passphrase is entered.',
    image: '/screenshots/workspace-import-review.png',
  },
  'multi-window-tabs': {
    id: 'multi-window-tabs',
    title: 'Experimental multi-window tabs',
    caption: 'A detached editor window keeps its tab, target, and environment while sharing the main workspace and backend.',
    image: '/screenshots/multi-window-tabs.png',
  },
  'oracle-paging': {
    id: 'oracle-paging',
    title: 'Oracle paging and completion',
    caption: 'Load more for large Oracle schema branches with selected-schema progressive object and column completion.',
  },
}

export function getScreenshotSlot(id: ScreenshotId) {
  return screenshotSlots[id]
}
