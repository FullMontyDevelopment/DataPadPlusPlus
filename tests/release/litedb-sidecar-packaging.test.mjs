import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { litedbTargets } from './litedb-sidecar-config.mjs'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
test('LiteDB runtime ships in native and portable packages for every release target', () => {
  const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
  assert.ok(config.bundle.externalBin.includes('binaries/datapadplusplus-litedb-runtime'))
  assert.ok(config.bundle.resources.includes('resources/licenses/LiteDB-LICENSE.txt'))
  assert.match(config.build.beforeDevCommand, /litedb:sidecar:ensure/)
  assert.match(config.build.beforeBuildCommand, /litedb:sidecar:prepare/)
  assert.match(read('apps/desktop/src-tauri/tauri.e2e.conf.json'), /litedb:sidecar:ensure/)
  assert.match(read('.vscode/tasks.json'), /litedb:sidecar:ensure/)
  assert.deepEqual(Object.keys(litedbTargets), ['win-x64', 'linux-x64', 'osx-arm64'])
  const workflow = read('.github/workflows/release.yml')
  assert.match(workflow, /litedb:sidecar:smoke/)
  assert.match(workflow, /Copy-Item -LiteralPath \$litedbSource -Destination \$litedbPortable/)
  assert.match(workflow, /codesign --verify --strict --verbose=2 \$litedbSidecar/)
  assert.match(read('.github/workflows/ci.yml'), /litedb:sidecar:test/)
  assert.match(read('.github/workflows/live-fixtures.yml'), /litedb:sidecar:ensure/)
})
