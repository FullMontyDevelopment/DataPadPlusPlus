import { resolve } from 'node:path'

export const config = {
  runner: 'local',
  specs: [resolve(import.meta.dirname, 'specs', '**', '*.e2e.mjs')],
  maxInstances: 1,
  hostname: '127.0.0.1',
  port: Number(process.env.DATAPADPLUSPLUS_TAURI_DRIVER_PORT ?? 4444),
  path: '/',
  logLevel: 'warn',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  capabilities: [
    {
      browserName: 'wry',
      'tauri:options': {
        application: process.env.DATAPADPLUSPLUS_DESKTOP_BINARY,
        args: [],
        env: {
          DATAPADPLUSPLUS_WORKSPACE_DIR: process.env.DATAPADPLUSPLUS_WORKSPACE_DIR,
          DATAPADPLUSPLUS_SECRET_STORE: process.env.DATAPADPLUSPLUS_SECRET_STORE ?? 'file',
          DATAPADPLUSPLUS_SECRET_FILE: process.env.DATAPADPLUSPLUS_SECRET_FILE,
          DATAPADPLUSPLUS_FIXTURE_RUN: process.env.DATAPADPLUSPLUS_FIXTURE_RUN ?? '1',
          DATAPADPLUSPLUS_FIXTURE_PROFILE:
            process.env.DATAPADPLUSPLUS_FIXTURE_PROFILE ?? '',
          DATAPADPLUSPLUS_SQLITE_FIXTURE: process.env.DATAPADPLUSPLUS_SQLITE_FIXTURE,
        },
      },
    },
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 180000,
  },
}
