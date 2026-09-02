import { mkdirSync, rmSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const application = process.env.DATAPADPLUSPLUS_DESKTOP_BINARY ?? resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'datapadplusplus-desktop.exe')
const workspace = process.env.DATAPADPLUSPLUS_WORKSPACE_DIR ?? resolve(repoRoot, 'tests', 'fixtures', '.screenshot-workspace')

export const config = {
  runner: 'local',
  specs: [resolve(import.meta.dirname, 'specs', 'docs-screenshots.e2e.mjs')],
  maxInstances: 1,
  services: [[
    '@wdio/tauri-service',
    {
      appBinaryPath: application,
      driverProvider: 'embedded',
      embeddedPort: Number(process.env.DATAPADPLUSPLUS_WEBDRIVER_PORT ?? 4446),
      env: {
        DATAPADPLUSPLUS_WORKSPACE_DIR: workspace,
        DATAPADPLUSPLUS_SECRET_STORE: 'file',
        DATAPADPLUSPLUS_SECRET_FILE: resolve(workspace, 'secrets.json'),
        DATAPADPLUSPLUS_FIXTURE_RUN: '1',
        DATAPADPLUSPLUS_FIXTURE_PROFILE: 'all',
        DATAPADPLUSPLUS_SCREENSHOT_SEED: '1',
      },
      startTimeout: 60000,
      statusPollTimeout: 5000,
    },
  ]],
  logLevel: 'warn',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  capabilities: [{ browserName: 'tauri', 'tauri:options': { application, args: [] } }],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 900000 },
  onPrepare() {
    if (basename(workspace) !== '.screenshot-workspace') {
      throw new Error(`Refusing to reset an unexpected screenshot workspace: ${workspace}`)
    }
    rmSync(workspace, { recursive: true, force: true })
    mkdirSync(workspace, { recursive: true })
  },
}
