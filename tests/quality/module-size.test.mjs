import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const defaultMaxLines = 400

const documentedExceptions = new Map([
  [
    'apps/desktop/src/app/components/workbench/BottomPanel.tsx',
    {
      maxLines: 430,
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
      maxLines: 560,
      reason: 'Completion providers share cursor context helpers and datastore-specific insertion behavior.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/ObjectViewWorkspace.tsx',
    {
      maxLines: 1500,
      reason: 'Mongo object-view descriptors and purpose-built view routing are still one active adapter surface.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/OracleObjectViewWorkspace.tsx',
    {
      maxLines: 950,
      reason: 'Oracle object-view pages share descriptor-driven shells and permission-state handling.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/query-builder/QueryBuilderPanel.tsx',
    {
      maxLines: 450,
      reason: 'Mongo builder filter, projection, sort, and drag/drop behavior remain one cohesive editor.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/query-builder/RedisKeyBrowserPanel.tsx',
    {
      maxLines: 470,
      reason: 'Redis scan controls, virtual key list, and key selection state need shared local request guards.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/RedisObjectViewWorkspace.tsx',
    {
      maxLines: 910,
      reason: 'Redis object-view dashboards, type sections, and capability states share one adapter view shell.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/RelationalObjectViewWorkspace.tsx',
    {
      maxLines: 590,
      reason: 'SQL-family object views share table/procedure/security rendering and warning states.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/KeyValueResultsView.tsx',
    {
      maxLines: 430,
      reason: 'Redis key inspection, typed value rendering, and guarded edit actions remain one result view.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/DataGridView.tsx',
    {
      maxLines: 455,
      reason: 'Virtualized grid selection, keyboard copy, and editing coordination are tightly coupled.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/results/DocumentResultsView.tsx',
    {
      maxLines: 520,
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
    'apps/desktop/src/app/components/workbench/RightDrawer.connection-modes.tsx',
    {
      maxLines: 850,
      reason: 'Connection method forms share stateful local-file and cloud mode behavior.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-object-tree.tsx',
    {
      maxLines: 1040,
      reason: 'Tree rendering, scoped refresh, batching, and context menu behavior are one UI unit.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
    {
      maxLines: 810,
      reason: 'Fallback connection tree templates cover all datastore families until live explorers mature.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
    {
      maxLines: 2450,
      reason: 'Data-heavy datastore registry centralizes family placement and object actions.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.library-pane.tsx',
    {
      maxLines: 1700,
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
    'apps/desktop/src/app/state/app-actions-runtime.ts',
    {
      maxLines: 470,
      reason: 'Runtime action wrappers coordinate tab, metrics, explorer, and test-suite command refreshes.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-tabs.ts',
    {
      maxLines: 590,
      reason: 'Tab and Library actions share save/open lifecycle state.',
    },
  ],
  [
    'apps/desktop/src/app/state/workspace-migration.ts',
    {
      maxLines: 580,
      reason: 'Workspace schema migration intentionally keeps versioned normalization in one place.',
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
      maxLines: 2500,
      reason: 'Browser-preview explorer fixtures are data-heavy and should split by adapter in a later pass.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-oracle-explorer.ts',
    {
      maxLines: 500,
      reason: 'Oracle preview tree and object-view payloads remain together to avoid live Oracle CI dependency.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-tabs.ts',
    {
      maxLines: 850,
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
    'apps/desktop/src-tauri/src/app/runtime/datastore_commands.rs',
    {
      maxLines: 620,
      reason: 'Datastore command boundary centralizes execution, paging, diagnostics, and guardrail dispatch.',
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
    'apps/desktop/src-tauri/src/app/runtime/workspace.rs',
    {
      maxLines: 470,
      reason: 'Workspace import/export owns encryption validation, snapshot migration, and bundle boundaries.',
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
