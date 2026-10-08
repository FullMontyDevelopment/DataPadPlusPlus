import { spawnSync } from 'node:child_process'
import { litedbContext } from './litedb-sidecar-config.mjs'

const context = litedbContext()
// Scope the runtime override to this test process, never to the user's environment.
const result = spawnSync('cargo', ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--lib', 'litedb_bundled_', '--', '--ignored'], {
  cwd: context.root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, DATAPADPLUSPLUS_LITEDB_SIDECAR_PATH: context.destination },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
