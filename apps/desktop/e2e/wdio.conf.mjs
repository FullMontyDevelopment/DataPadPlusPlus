import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const suite = process.env.DATAPADPLUSPLUS_E2E_SUITE ?? 'fixtures'
const specsBySuite = {
  fixtures: [resolve(import.meta.dirname, 'specs', 'desktop-fixtures.e2e.mjs')],
  smoke: [resolve(import.meta.dirname, 'specs', 'desktop-sqlite-smoke.e2e.mjs')],
}
const application = process.env.DATAPADPLUSPLUS_DESKTOP_BINARY
const appEnvironment = {
  DATAPADPLUSPLUS_WORKSPACE_DIR: process.env.DATAPADPLUSPLUS_WORKSPACE_DIR,
  DATAPADPLUSPLUS_SECRET_STORE: process.env.DATAPADPLUSPLUS_SECRET_STORE ?? 'file',
  DATAPADPLUSPLUS_SECRET_FILE: process.env.DATAPADPLUSPLUS_SECRET_FILE,
  DATAPADPLUSPLUS_FIXTURE_RUN: process.env.DATAPADPLUSPLUS_FIXTURE_RUN ?? '1',
  DATAPADPLUSPLUS_FIXTURE_PROFILE: process.env.DATAPADPLUSPLUS_FIXTURE_PROFILE ?? '',
  DATAPADPLUSPLUS_SQLITE_FIXTURE: process.env.DATAPADPLUSPLUS_SQLITE_FIXTURE,
  DATAPADPLUSPLUS_E2E_SUITE: suite,
}

if (!(suite in specsBySuite)) {
  throw new Error(`Unknown DataPad++ desktop E2E suite: ${suite}`)
}

export const config = {
  runner: 'local',
  specs: specsBySuite[suite],
  maxInstances: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: application,
        driverProvider: 'embedded',
        embeddedPort: Number(process.env.DATAPADPLUSPLUS_WEBDRIVER_PORT ?? 4445),
        env: appEnvironment,
        startTimeout: 60000,
        statusPollTimeout: 5000,
      },
    ],
  ],
  logLevel: 'warn',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application,
        args: [],
      },
    },
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 180000,
  },
  afterTest: async function afterTest(test, _context, result) {
    if (result.passed || !process.env.DATAPADPLUSPLUS_WORKSPACE_DIR) {
      return
    }

    const artifactDirectory = resolve(
      process.env.DATAPADPLUSPLUS_WORKSPACE_DIR,
      '.e2e-artifacts',
    )
    const fileName = `${test.title.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 100)}.png`
    mkdirSync(artifactDirectory, { recursive: true })
    await browser.saveScreenshot(resolve(artifactDirectory, fileName))
  },
}
