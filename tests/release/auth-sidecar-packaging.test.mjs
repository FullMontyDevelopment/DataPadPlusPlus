import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { authTargets } from './auth-sidecar-config.mjs'
const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
test('authentication helper is included in native and portable release paths', () => {
  const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
  assert.ok(config.bundle.externalBin.includes('binaries/datapadplusplus-auth-runtime'))
  assert.match(config.build.beforeDevCommand, /auth:sidecar:ensure/)
  assert.match(config.build.beforeBuildCommand, /auth:sidecar:prepare/)
  assert.match(read('apps/desktop/src-tauri/tauri.e2e.conf.json'), /auth:sidecar:ensure/)
  assert.equal(Object.keys(authTargets).length, 3)
  assert.ok(config.bundle.linux.deb.recommends.includes('libsecret-1-0'))
  assert.ok(config.bundle.linux.rpm.recommends.includes('libsecret'))
  assert.match(read('apps/desktop/src-tauri/' + config.bundle.macOS.entitlements), /com.apple.security.cs.allow-jit/)
  assert.doesNotMatch(read('apps/desktop/src-tauri/' + config.bundle.macOS.entitlements), /com.apple.security.get-task-allow|com.apple.security.cs.disable-library-validation/)
  const workflow = read('.github/workflows/release.yml')
  assert.match(workflow, /auth:sidecar:smoke/)
  assert.match(workflow, /Copy-Item -LiteralPath \$authSource -Destination \$authPortable/)
  assert.match(workflow, /codesign --verify --strict --verbose=2 \$authSidecar/)
})
test('the helper uses protected cache and public-client browser sign-in without broker or credential arguments', () => {
  const helper = read('apps/desktop/src-tauri/sidecars/auth/Program.cs')
  assert.match(helper, /VerifyPersistence\(\)/)
  assert.match(helper, /WithUseEmbeddedWebView\(false\)/)
  assert.match(helper, /Prompt.SelectAccount/)
  assert.doesNotMatch(helper, /WithUnprotectedFile|WithClientSecret|Console.Error|Console.WriteLine/)
  const native = read('apps/desktop/src-tauri/src/app/runtime/sqlserver_auth.rs')
  assert.doesNotMatch(native, /\.args?\(/)
  const commands = read('apps/desktop/src-tauri/src/commands/workspace/sqlserver_auth.rs')
  assert.doesNotMatch(commands, /access_token|accessToken/)
  assert.match(commands, /request.workspace_id != crate::persistence::active_workspace_id/)
  assert.match(read('.github/workflows/ci.yml'), /platform: \[windows-latest, ubuntu-22.04, macos-15\]/)
})
