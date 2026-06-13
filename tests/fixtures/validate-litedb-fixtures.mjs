import { spawnSync } from 'node:child_process'

const testName = 'litedb_sidecar'

const result = spawnSync(
  'cargo',
  [
    'test',
    '--manifest-path',
    'apps/desktop/src-tauri/Cargo.toml',
    '--lib',
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
  console.log('ok - LiteDB: local-file preflight plus fixture-token and local sidecar-process read dispatch, bounded response normalization, process open-failure mapping, timeout, and redaction evidence')
  console.log('note - optional real .NET LiteDB engine sidecar validation is covered by DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet, including guarded document CRUD, encrypted-file success/failure evidence, JSON collection import/export execution, file-storage import/export/delete, and index/collection management execution; packaged sidecar distribution and exclusive writer-lock validation remain outside this default checkpoint.')
}
