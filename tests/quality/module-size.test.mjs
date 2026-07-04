import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const defaultMaxLines = 400

const documentedExceptions = new Map([
  [
    'apps/desktop/src/app/components/workbench/ApiServerWorkspace.tsx',
    {
      maxLines: 2529,
      reason: 'Datastore API server workspace keeps server selection, settings, metrics, logs, lifecycle controls, and deletion guardrails in one operational surface.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/FirstInstallGuide.tsx',
    {
      maxLines: 1009,
      reason: 'First-install guide coordinates persisted tutorial state, real UI callbacks, spotlight layout, and resume behavior in one overlay surface.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/McpServerWorkspace.tsx',
    {
      maxLines: 1628,
      reason: 'MCP server workspace keeps server configuration, tokens, lifecycle controls, observability, and client setup snippets in one operational surface.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/cassandra/CassandraObjectViewWorkspace.tsx',
    {
      maxLines: 460,
      reason: 'Cassandra object views share keyspace/table diagnostics, schema metadata, and permission-state rendering.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/cosmosdb/CosmosObjectViewWorkspace.tsx',
    {
      maxLines: 500,
      reason: 'Cosmos DB object views keep database/container throughput, partitioning, indexing, and diagnostics in one adapter workspace.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/dynamodb/DynamoObjectViewWorkspace.tsx',
    {
      maxLines: 560,
      reason: 'DynamoDB object views share table, index, capacity, TTL, stream, backup, and alarm rendering helpers.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/common/graph/GraphObjectViewWorkspace.tsx',
    {
      maxLines: 570,
      reason: 'Graph object views share label, relationship, property, index, constraint, procedure, and security summaries.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/influxdb/InfluxObjectViewWorkspace.tsx',
    {
      maxLines: 535,
      reason: 'InfluxDB object views share bucket, measurement, tag, field, task, token, and diagnostics tables.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/litedb/LiteDbObjectViewWorkspace.tsx',
    {
      maxLines: 475,
      reason: 'LiteDB object views share local-file database, collection, index, file storage, and pragma-style helpers.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/BottomPanel.tsx',
    {
      maxLines: 440,
      reason: 'Bottom results docking, tabs, history, and execution status are coupled by layout state.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/EnvironmentWorkspace.tsx',
    {
      maxLines: 425,
      reason: 'Dense environment editor with color, variable, and clone flows kept together for now.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/intellisense/catalog.ts',
    {
      maxLines: 500,
      reason: 'Completion catalog assembly spans datastore families but shares one cache-normalization path.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/intellisense/providers.ts',
    {
      maxLines: 580,
      reason: 'Completion providers share cursor context helpers, variable suggestions, and datastore-specific insertion behavior.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/mongodb/MongoFilterBuilderSection.tsx',
    {
      maxLines: 640,
      reason: 'Mongo filter builder keeps nested groups, row movement, drag/drop targeting, and per-row operator editing in one editor section.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/mongodb/MongoObjectViewWorkspace.tsx',
    {
      maxLines: 430,
      reason: 'Mongo object views coordinate collection/database/admin payloads, scoped query actions, and insert/index panels in one workspace.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/mongodb/MongoOverviewView.tsx',
    {
      maxLines: 950,
      reason: 'Mongo overview rendering keeps collection metadata, index summaries, schema samples, storage stats, and action panels together for one object view.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/opentsdb/OpenTsdbObjectViewWorkspace.tsx',
    {
      maxLines: 540,
      reason: 'OpenTSDB object views share metric, tag, UID, tree, storage, and diagnostics summaries.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/oracle/OracleObjectViewWorkspace.tsx',
    {
      maxLines: 520,
      reason: 'Oracle object-view pages remain together while row normalization and shared primitives are split out.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/prometheus/PrometheusObjectViewWorkspace.tsx',
    {
      maxLines: 550,
      reason: 'Prometheus object views share metric, label, series, target, rule, alert, and TSDB diagnostics rendering.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/query-builder/QueryBuilderPanel.tsx',
    {
      maxLines: 455,
      reason: 'Mongo builder filter, projection, sort, and drag/drop behavior remain one cohesive editor.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/query-builder/search-dsl.ts',
    {
      maxLines: 460,
      reason: 'Search DSL builder state, filter normalization, generated query text, and aggregation handling share one deterministic serialization path.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/common/keyvalue/RedisKeyBrowserPanel.tsx',
    {
      maxLines: 470,
      reason: 'Redis scan controls, virtual key list, and key selection state need shared local request guards.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/common/search/SearchObjectViewWorkspace.tsx',
    {
      maxLines: 575,
      reason: 'Search object views share index, mapping, shard, segment, ingest, security, and diagnostics surfaces.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/KeyValueResultsView.tsx',
    {
      maxLines: 600,
      reason: 'Redis key inspection and guarded edit orchestration remain together while headers, rows, panels, and request helpers are split out.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/DataGridView.tsx',
    {
      maxLines: 494,
      reason: 'Virtualized grid selection, keyboard copy, and editing coordination are tightly coupled.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/DocumentResultsView.tsx',
    {
      maxLines: 694,
      reason: 'Document virtualization, inline editing, inspector, and field drag behavior share row state.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/mongo-explain-plan.ts',
    {
      maxLines: 430,
      reason: 'Mongo explain normalization keeps parser, warnings, and plan metrics together for testability.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/RightDrawer.connection-blade.tsx',
    {
      maxLines: 405,
      reason: 'Connection drawer fields, engine-specific controls, safety flags, and save/test actions remain one profile-editing blade.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/RightDrawer.diagnostics-blade.tsx',
    {
      maxLines: 450,
      reason: 'Settings, backup, restore, and workspace health are one end-user settings blade for now.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/RightDrawer.connection-modes.tsx',
    {
      maxLines: 850,
      reason: 'Connection method forms share stateful local-file and cloud mode behavior.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-object-tree.tsx',
    {
      maxLines: 1280,
      reason: 'Tree rendering, scoped refresh, batching, and context menu behavior are one UI unit.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
    {
      maxLines: 1120,
      reason: 'Fallback connection tree templates cover all datastore families until live explorers mature.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
    {
      maxLines: 3150,
      reason: 'Data-heavy datastore registry centralizes family placement and object actions.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.library-pane.tsx',
    {
      maxLines: 2175,
      reason: 'Library tree drag/drop, recents, search, context menus, and environment badges remain coupled.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.node-icons.tsx',
    {
      maxLines: 500,
      reason: 'Datastore and object-kind icon mapping is intentionally centralized for consistent tree visuals.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/workspace-search-index.ts',
    {
      maxLines: 492,
      reason: 'Workspace search indexing keeps library, connection, tab, environment, and API server normalization together for ranking consistency.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/WorkspaceSearchWorkspace.tsx',
    {
      maxLines: 509,
      reason: 'Workspace search UI keeps query input, scope filters, grouped results, selection state, and navigation callbacks together.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/datastores/common/warehouse/WarehouseObjectViewWorkspace.tsx',
    {
      maxLines: 550,
      reason: 'Warehouse object views share schema, table, stage, compute, job, security, and diagnostics summaries across warehouse engines.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SecurityChecksWorkspace.tsx',
    {
      maxLines: 985,
      reason: 'Security checks workspace keeps vulnerability and posture lanes, target grouping, mute state, summaries, guidance tooltips, and detail rendering together for one experimental surface.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SettingsExperimentalPanel.tsx',
    {
      maxLines: 455,
      reason: 'Experimental plugin settings keep opt-in plugin toggles, copy, and guarded preference updates together while the plugin list is still moving quickly.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-workspace.ts',
    {
      maxLines: 1034,
      reason: 'Workspace actions coordinate import/export, diagnostics, logs, backups, API server control, and update commands through one app action boundary.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-runtime.ts',
    {
      maxLines: 620,
      reason: 'Runtime action wrappers coordinate per-tab execution, paging, metrics, explorer, and test-suite command refreshes.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-state.tsx',
    {
      maxLines: 461,
      reason: 'App provider owns bootstrap, shared action wiring, startup health checks, and update-check orchestration around one reducer state.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-state-types.ts',
    {
      maxLines: 472,
      reason: 'App state types centralize workbench tabs, drawers, tutorial state, runtime status, and action contracts for reducer consistency.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-state-reducer-helpers.ts',
    {
      maxLines: 640,
      reason: 'Reducer helpers keep tab, Library, explorer metadata, execution, and result merge invariants together for state consistency.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-tabs.ts',
    {
      maxLines: 659,
      reason: 'Tab and Library actions share save/open lifecycle state.',
    },
  ],
  [
    'apps/desktop/src/app/state/workspace-migration.ts',
    {
      maxLines: 1350,
      reason: 'Workspace schema migration intentionally keeps versioned normalization, Library migration, variable syntax migration, and security-check snapshot normalization in one place.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-execution.ts',
    {
      maxLines: 460,
      reason: 'Browser-preview execution keeps deterministic query, script, test, and result lifecycle behavior in one service boundary.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-operations.ts',
    {
      maxLines: 500,
      reason: 'Browser-preview operation plans keep guardrail, edit, and deterministic adapter operation simulation together.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-store.ts',
    {
      maxLines: 506,
      reason: 'Browser preview store keeps workspace snapshot persistence, switcher registry migration, and localStorage compatibility in one deterministic runtime boundary.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/client-api-server.ts',
    {
      maxLines: 901,
      reason: 'API server client helpers centralize command shapes, runtime mapping, metrics, logs, tokens, and setup payload conversion.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/client-mcp-server.ts',
    {
      maxLines: 528,
      reason: 'MCP server client helpers share status, token, observability, setup preview, and settings command contracts.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/client-tabs.ts',
    {
      maxLines: 410,
      reason: 'Tab client helpers keep query, explorer, metrics, console, settings, and test-suite tab command shapes aligned.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/client-workspace.ts',
    {
      maxLines: 654,
      reason: 'Workspace client helpers coordinate snapshot, import/export, backup, and settings command shapes.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-datastore-platform.ts',
    {
      maxLines: 490,
      reason: 'Browser-preview datastore manifests and contract payloads stay centralized for deterministic tests.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-explorer.ts',
    {
      maxLines: 7200,
      reason: 'Browser-preview explorer fixtures are deterministic adapter test data and are lazy-loaded outside the startup bundle; split by adapter when the preview contract stabilizes.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/datastores/oracle/browser-oracle-explorer.ts',
    {
      maxLines: 500,
      reason: 'Oracle preview tree and object-view payloads remain together to avoid live Oracle CI dependency.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-tabs.ts',
    {
      maxLines: 930,
      reason: 'Browser-preview tab persistence mirrors the desktop tab runtime contract.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-tests.ts',
    {
      maxLines: 450,
      reason: 'Browser-preview test suite simulation stays together with its deterministic run result helpers.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/datastore_api_server.rs',
    {
      maxLines: 8411,
      reason: 'Datastore API server runtime owns HTTP routing, server lifecycle, request execution, metrics, logs, and persisted server configuration in one sidecar boundary.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/datastore_security_checks.rs',
    {
      maxLines: 3910,
      reason: 'Datastore security checks runtime keeps version detection, posture rule evaluation, vulnerability-source clients, cache policy, target mapping, and finding normalization together.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/datastore_mcp_client_setup.rs',
    {
      maxLines: 613,
      reason: 'MCP client setup runtime validates target clients, merges JSON/TOML config formats, protects tokens, and writes backups atomically.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/datastore_mcp_server.rs',
    {
      maxLines: 2604,
      reason: 'Datastore MCP server runtime keeps transport routing, tool schemas, authorization, logs, metrics, and persisted server settings together.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/datastore_commands.rs',
    {
      maxLines: 620,
      reason: 'Datastore command boundary centralizes execution, paging, diagnostics, and guardrail dispatch.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/environments.rs',
    {
      maxLines: 560,
      reason: 'Environment runtime owns variable normalization, secret resolution, interpolation, and inheritance safety checks.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/fixtures.rs',
    {
      maxLines: 402,
      reason: 'Fixture runtime keeps workspace seed profiles, local fixture metadata, and validation helpers together for deterministic development checks.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/library.rs',
    {
      maxLines: 1100,
      reason: 'Library runtime owns folder, item, migration, and local-file save invariants.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/profiles.rs',
    {
      maxLines: 790,
      reason: 'Connection and environment profile commands share validation and persistence helpers.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/query_tabs.rs',
    {
      maxLines: 700,
      reason: 'Query, explorer, metrics, and test-suite tab builders share title and target dedupe invariants.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/tabs.rs',
    {
      maxLines: 640,
      reason: 'Tab lifecycle, scoped query creation, and reopen behavior share ordering invariants.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/settings_tabs.rs',
    {
      maxLines: 504,
      reason: 'Settings tab runtime keeps diagnostics, safety, update, shortcut, and preference tab construction together.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/workspace.rs',
    {
      maxLines: 1079,
      reason: 'Workspace import/export owns encryption validation, snapshot migration, secret stripping, and bundle boundaries.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/tests_workbench.rs',
    {
      maxLines: 550,
      reason: 'Test-suite runtime owns visual/raw edits, deterministic execution, cancellation, and templates.',
    },
  ],
])

test('workbench and runtime modules stay within documented size budgets', async () => {
  const files = [
    ...(await sourceFiles('apps/desktop/src/app/components/workbench', ['.ts', '.tsx'])),
    ...(await sourceFiles('apps/desktop/src/app/state', ['.ts', '.tsx'])),
    ...(await sourceFiles('apps/desktop/src/services/runtime', ['.ts', '.tsx'])),
    ...(await sourceFiles('apps/desktop/src-tauri/src/app', ['.rs'])),
  ].filter((file) => !file.includes('.test.') && !file.endsWith('/mod.rs'))

  const failures = []

  for (const file of files) {
    const relativePath = normalizePath(path.relative(repoRoot, file))
    const lines = lineCount(await readFile(file, 'utf8'))
    const exception = documentedExceptions.get(relativePath)
    const limit = exception?.maxLines ?? defaultMaxLines

    if (exception) {
      assert.ok(exception.reason, `${relativePath} needs a documented exception reason`)
    }

    if (lines > limit) {
      failures.push(`${relativePath}: ${lines} lines exceeds ${limit}`)
    }
  }

  assert.deepEqual(failures, [])
})

async function sourceFiles(root, extensions) {
  const rootPath = path.join(repoRoot, root)
  const entries = await readdir(rootPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name)

      if (entry.isDirectory()) {
        return sourceFiles(path.relative(repoRoot, fullPath), extensions)
      }

      return extensions.includes(path.extname(entry.name)) ? [fullPath] : []
    }),
  )

  return files.flat()
}

function lineCount(contents) {
  return contents.split(/\r?\n/).length
}

function normalizePath(file) {
  return file.split(path.sep).join('/')
}
