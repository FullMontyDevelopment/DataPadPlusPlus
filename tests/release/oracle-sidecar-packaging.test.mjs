import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')

test('Tauri packages the managed Oracle runtime and license', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'))

  assert.match(config.build.beforeDevCommand, /oracle:sidecar:ensure/)
  assert.match(config.build.beforeBuildCommand, /oracle:sidecar:prepare/)
  assert.ok(config.bundle.externalBin.includes('binaries/datapadplusplus-oracle-runtime'))
  assert.ok(
    config.bundle.resources.includes('resources/licenses/Oracle.ManagedDataAccess.Core-LICENSE.txt'),
  )
})

test('no-bundle desktop test builds still prepare the required external Oracle runtime', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'apps/desktop/src-tauri/tauri.e2e.conf.json'), 'utf8'))
  assert.match(config.build.beforeBuildCommand, /oracle:sidecar:ensure.*npm run build/)
})

test('CI installs the sidecar prerequisites before deterministic tests and native smoke builds', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
  const [deterministic, native] = workflow.split('  deterministic-tests:')[1].split('  native-smoke:')
  const dotnet = (job) => job.indexOf('uses: actions/setup-dotnet@')
  assert.ok(dotnet(deterministic) >= 0)
  assert.ok(deterministic.indexOf('npm run oracle:sidecar:ensure') > dotnet(deterministic))
  assert.ok(deterministic.indexOf('npm run ci:test') > deterministic.indexOf('npm run oracle:sidecar:ensure'))
  assert.ok(dotnet(native) >= 0)
  assert.ok(native.indexOf('npm run e2e:desktop:build') > dotnet(native))
})

test('Oracle sidecar pins the managed driver and all release targets', () => {
  const project = readFileSync(
    resolve(root, 'apps/desktop/src-tauri/sidecars/oracle/DataPadPlusPlus.OracleSidecar.csproj'),
    'utf8',
  )
  const prepare = readFileSync(resolve(root, 'tests/release/prepare-oracle-sidecar.mjs'), 'utf8')
  const sidecarConfig = readFileSync(resolve(root, 'tests/release/oracle-sidecar-config.mjs'), 'utf8')
  const smoke = readFileSync(resolve(root, 'tests/release/smoke-oracle-sidecar.mjs'), 'utf8')

  assert.match(project, /Oracle\.ManagedDataAccess\.Core" Version="23\.26\.300"/)
  assert.match(project, /<OutputType>Exe<\/OutputType>/)
  assert.doesNotMatch(project, /<OutputType>WinExe<\/OutputType>/)
  assert.match(sidecarConfig, /win-x64/)
  assert.match(sidecarConfig, /linux-x64/)
  assert.match(sidecarConfig, /osx-arm64/)
  assert.match(sidecarConfig, /DATAPADPLUSPLUS_ORACLE_RID/)
  assert.match(prepare, /chmodSync\(context\.destination, 0o755\)/)
  assert.match(prepare, /PublishSingleFile=true/)
  assert.match(prepare, /'--self-contained', 'true'/)
  assert.match(sidecarConfig, /Oracle\.ManagedDataAccess\.Core-LICENSE\.txt/)
  assert.match(smoke, /operation: 'health'/)
  assert.match(smoke, /shell: false/)
  assert.match(smoke, /windowsHide: true/)
  assert.match(smoke, /health\.consoleAttached !== false/)
  assert.match(smoke, /constants\.X_OK/)
})
