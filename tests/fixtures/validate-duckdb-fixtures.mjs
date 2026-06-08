import { spawnSync } from 'node:child_process'

const testName = 'duckdb_local_file_fixture_validates_read_profile_catalog_and_guard_boundaries'

const result = spawnSync(
  'cargo',
  [
    'test',
    '--manifest-path',
    'apps/desktop/src-tauri/Cargo.toml',
    testName,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  },
)

if (result.stdout) {
  process.stdout.write(result.stdout)
}
if (result.stderr) {
  process.stderr.write(result.stderr)
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1
} else {
  console.log('ok - DuckDB: bundled local-file read, EXPLAIN, profile, catalog, diagnostics, guarded CSV export/import, backup-folder, database-file preflight/read-only guard, explicit lock-boundary, JSON/Parquet preloaded-extension-only boundary, restore-package preflight, restore/admin/extension execution-boundary, and guard-boundary evidence')
  console.log('note - DuckDB extension-loaded JSON/Parquet execution and any promoted mutation/admin/extension execution remain outside this scoped native-complete fixture claim.')
}
