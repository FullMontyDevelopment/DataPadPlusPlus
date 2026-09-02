import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

test('native smoke suite remains SQLite-only and exercises high-risk app boundaries', () => {
  const runner = source('apps/desktop/e2e/run-tauri-driver.mjs')
  const config = source('apps/desktop/e2e/wdio.conf.mjs')
  const spec = source('apps/desktop/e2e/specs/desktop-sqlite-smoke.e2e.mjs')
  const fixtures = source('apps/desktop/src-tauri/src/app/runtime/fixtures.rs')
  const workflow = source('.github/workflows/ci.yml')

  assert.match(runner, /suite === 'smoke' \? 'sqlite-smoke'/)
  assert.match(workflow, /npm run e2e:desktop:build/)
  assert.match(source('package.json'), /tauri\.js build --no-bundle --ci --features webdriver/)
  assert.match(source('apps/desktop/src-tauri/tauri.e2e.conf.json'), /"active": false/)
  assert.match(source('apps/desktop/src-tauri/Cargo.toml'), /webdriver = \["dep:tauri-plugin-wdio-webdriver"\]/)
  assert.match(runner, /tests['"], ['"]fixtures['"], ['"]sqlite['"], ['"]seed\.py/)
  assert.match(config, /smoke: \[resolve\(import\.meta\.dirname, 'specs', 'desktop-sqlite-smoke\.e2e\.mjs'\)\]/)
  assert.match(fixtures, /return seed\.id == "fixture-sqlite"/)
  assert.doesNotMatch(spec, /docker/i)

  for (const requiredScenario of [
    'no invented failure state',
    'executes AND and OR builder drafts',
    'switches the Explorer and tabs',
    'moves a tab to a native editor window',
  ]) {
    assert.match(spec, new RegExp(requiredScenario))
  }
})
