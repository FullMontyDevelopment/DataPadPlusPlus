import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const generatedEnvironment = resolve('tests', 'fixtures', '.generated.env')

if (existsSync(generatedEnvironment)) {
  for (const line of readFileSync(generatedEnvironment, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator)
    const value = trimmed.slice(separator + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

const result = spawnSync(
  'cargo',
  [
    'test',
    '--manifest-path',
    'apps/desktop/src-tauri/Cargo.toml',
    'oracle_live_fixture_pages',
    '--',
    '--ignored',
    '--nocapture',
    '--test-threads=1',
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  },
)

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  throw new Error(`Live DataPad++ Oracle paging validation failed with exit code ${result.status}.`)
}

console.log('DataPad++ Oracle Explorer and completion paging passed against the live fixture.')
