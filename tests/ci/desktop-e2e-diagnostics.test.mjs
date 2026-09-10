import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

async function fixtureConfig(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'datapad-e2e-diagnostics-'))
  const previous = process.env.DATAPADPLUSPLUS_WORKSPACE_DIR
  process.env.DATAPADPLUSPLUS_WORKSPACE_DIR = workspace
  t.after(() => {
    if (previous === undefined) delete process.env.DATAPADPLUSPLUS_WORKSPACE_DIR
    else process.env.DATAPADPLUSPLUS_WORKSPACE_DIR = previous
    rmSync(workspace, { recursive: true, force: true })
  })
  const url = new URL('../../apps/desktop/e2e/wdio.conf.mjs', import.meta.url)
  url.searchParams.set('test', workspace)
  return { workspace, config: (await import(url.href)).config }
}

test('desktop diagnostics capture native logs only inside the isolated artifact directory', async (t) => {
  const { workspace, config } = await fixtureConfig(t)
  assert.equal(config.outputDir, resolve(workspace, '.e2e-artifacts'))
  const service = config.services[0][1]
  assert.equal(service.captureBackendLogs, true)
  assert.equal(service.backendLogLevel, 'info')
  assert.equal(service.driverProvider, 'embedded')
  assert.equal(service.env.DATAPADPLUSPLUS_WORKSPACE_DIR, workspace)
})

test('a lost native session cannot mask the original failure in screenshot cleanup', async (t) => {
  const { config } = await fixtureConfig(t)
  const previousBrowser = globalThis.browser
  const previousWarn = console.warn
  const warnings = []
  let screenshots = 0
  globalThis.browser = {
    saveScreenshot: async () => {
      screenshots++
      throw new Error('private driver detail that must not appear in warnings')
    },
  }
  console.warn = (message) => warnings.push(message)
  t.after(() => {
    globalThis.browser = previousBrowser
    console.warn = previousWarn
  })
  await config.afterTest({ title: 'failed native test' }, {}, { passed: false })
  assert.equal(screenshots, 1)
  assert.deepEqual(warnings, ['Could not capture a failure screenshot: the desktop session is unavailable.'])
  await config.afterTest({ title: 'passing native test' }, {}, { passed: true })
  assert.equal(screenshots, 1)
})
