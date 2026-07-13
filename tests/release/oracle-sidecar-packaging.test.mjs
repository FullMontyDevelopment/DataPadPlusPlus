import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')

test('Tauri packages the managed Oracle runtime and license', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'))

  assert.match(config.build.beforeDevCommand, /oracle:sidecar:prepare/)
  assert.match(config.build.beforeBuildCommand, /oracle:sidecar:prepare/)
  assert.deepEqual(config.bundle.externalBin, ['binaries/datapadplusplus-oracle-runtime'])
  assert.ok(
    config.bundle.resources.includes('resources/licenses/Oracle.ManagedDataAccess.Core-LICENSE.txt'),
  )
})

test('Oracle sidecar pins the managed driver and all release targets', () => {
  const project = readFileSync(
    resolve(root, 'apps/desktop/src-tauri/sidecars/oracle/DataPadPlusPlus.OracleSidecar.csproj'),
    'utf8',
  )
  const prepare = readFileSync(resolve(root, 'tests/release/prepare-oracle-sidecar.mjs'), 'utf8')

  assert.match(project, /Oracle\.ManagedDataAccess\.Core" Version="23\.26\.200"/)
  assert.match(prepare, /win-x64/)
  assert.match(prepare, /linux-x64/)
  assert.match(prepare, /osx-arm64/)
  assert.match(prepare, /PublishSingleFile=true/)
  assert.match(prepare, /'--self-contained', 'true'/)
  assert.match(prepare, /Oracle\.ManagedDataAccess\.Core-LICENSE\.txt/)
})
