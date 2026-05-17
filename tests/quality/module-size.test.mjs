import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const defaultMaxLines = 400

const documentedExceptions = new Map([
  [
    'apps/desktop/src/app/components/workbench/EnvironmentWorkspace.tsx',
    {
      maxLines: 425,
      reason: 'Dense environment editor with color, variable, and clone flows kept together for now.',
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
    'apps/desktop/src/app/components/workbench/RightDrawer.connection-modes.tsx',
    {
      maxLines: 575,
      reason: 'Connection method forms share stateful local-file and cloud mode behavior.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-object-tree.tsx',
    {
      maxLines: 570,
      reason: 'Tree rendering, scoped refresh, batching, and context menu behavior are one UI unit.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
    {
      maxLines: 610,
      reason: 'Fallback connection tree templates cover all datastore families until live explorers mature.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
    {
      maxLines: 1120,
      reason: 'Data-heavy datastore registry centralizes family placement and object actions.',
    },
  ],
  [
    'apps/desktop/src/app/components/workbench/SideBar.library-pane.tsx',
    {
      maxLines: 1050,
      reason: 'Library tree drag/drop, recents, search, context menus, and environment badges remain coupled.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-runtime.ts',
    {
      maxLines: 430,
      reason: 'Runtime action wrappers coordinate tab, metrics, explorer, and test-suite command refreshes.',
    },
  ],
  [
    'apps/desktop/src/app/state/app-actions-tabs.ts',
    {
      maxLines: 520,
      reason: 'Tab and Library actions share save/open lifecycle state.',
    },
  ],
  [
    'apps/desktop/src/app/state/workspace-migration.ts',
    {
      maxLines: 440,
      reason: 'Workspace schema migration intentionally keeps versioned normalization in one place.',
    },
  ],
  [
    'apps/desktop/src/services/runtime/browser-tabs.ts',
    {
      maxLines: 610,
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
    'apps/desktop/src-tauri/src/app/runtime/library.rs',
    {
      maxLines: 830,
      reason: 'Library runtime owns folder, item, migration, and local-file save invariants.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/profiles.rs',
    {
      maxLines: 450,
      reason: 'Connection and environment profile commands share validation and persistence helpers.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/query_tabs.rs',
    {
      maxLines: 470,
      reason: 'Query, explorer, metrics, and test-suite tab builders share title and target dedupe invariants.',
    },
  ],
  [
    'apps/desktop/src-tauri/src/app/runtime/tabs.rs',
    {
      maxLines: 510,
      reason: 'Tab lifecycle, scoped query creation, and reopen behavior share ordering invariants.',
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
