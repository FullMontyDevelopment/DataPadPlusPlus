import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { prepareScreenshotWorkspace } from '../fixtures/screenshot-workspace.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const forbiddenTrackedPaths = [
  { pattern: /(^|\/)node_modules\//, description: 'dependency installation output' },
  { pattern: /(^|\/)dist\//, description: 'distribution output' },
  { pattern: /(^|\/)coverage\//, description: 'coverage output' },
  { pattern: /(^|\/)target(?:-[^/]+)?\//, description: 'Rust build output' },
  { pattern: /(^|\/)test-results\//, description: 'test runner output' },
  { pattern: /(^|\/)playwright-report\//, description: 'Playwright report output' },
  { pattern: /(^|\/)(?:\.cache|\.vite|\.turbo|\.nyc_output)\//, description: 'tool cache output' },
  { pattern: /^graphify-out\//, description: 'Graphify generated output' },
  {
    pattern: /^apps\/desktop\/src-tauri\/sidecars\/.*\/(?:bin|obj)\//,
    description: 'sidecar build output',
  },
  { pattern: /^apps\/desktop\/src-tauri\/gen\//, description: 'Tauri generated output' },
  {
    pattern: /^tests\/fixtures\/\.screenshot-workspace\//,
    description: 'generated screenshot workspace state',
  },
  { pattern: /^tests\/fixtures\/\.generated\.env$/, description: 'generated fixture environment' },
  {
    pattern: /^tests\/fixtures\/sqlite\/(?:datapadplusplus|datanaut)\.sqlite3$/,
    description: 'generated SQLite fixture database',
  },
  { pattern: /\.tsbuildinfo$/, description: 'TypeScript incremental build state' },
  { pattern: /\.(?:sqlite|db)-(?:wal|shm)$/, description: 'database journal state' },
]

const requiredGitIgnoreRules = [
  'node_modules/',
  'dist/',
  'coverage/',
  '/target/',
  '/target-*/',
  'test-results/',
  'playwright-report/',
  '.cache/',
  '.vite/',
  '.turbo/',
  'graphify-out/',
  '*.tsbuildinfo',
  'apps/desktop/src-tauri/sidecars/**/bin/',
  'apps/desktop/src-tauri/sidecars/**/obj/',
  'apps/desktop/src-tauri/gen/',
  'tests/fixtures/.generated.env',
  'tests/fixtures/.screenshot-workspace/',
  '*.sqlite-wal',
  '*.sqlite-shm',
  '*.db-wal',
  '*.db-shm',
]

const requiredGraphifyIgnoreRules = [
  'node_modules/',
  'dist/',
  'coverage/',
  'graphify-out/',
  'apps/desktop/src-tauri/target/',
  'apps/desktop/src-tauri/target-*/',
  'apps/desktop/src-tauri/sidecars/**/bin/',
  'apps/desktop/src-tauri/sidecars/**/obj/',
  'tests/',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*_test.*',
  '**/*_tests.*',
  '**/tests/',
  '**/test/',
  '**/fixtures/',
  '**/fixtures.*',
]

async function ignoreRules(fileName) {
  const source = await readFile(path.join(repoRoot, fileName), 'utf8')
  return new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  )
}

test('known generated and runtime artifact paths are not tracked by Git', async () => {
  const options = {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }
  const [{ stdout }, { stdout: deletedOutput }] = await Promise.all([
    execFileAsync('git', ['ls-files', '-z'], options),
    execFileAsync('git', ['ls-files', '--deleted', '-z'], options),
  ])
  const deletedFiles = new Set(deletedOutput.split('\0').filter(Boolean))
  const trackedFiles = stdout
    .split('\0')
    .filter((file) => file && !deletedFiles.has(file))
    .map((file) => file.replaceAll('\\', '/'))
  const failures = []

  for (const file of trackedFiles) {
    for (const rule of forbiddenTrackedPaths) {
      if (rule.pattern.test(file)) {
        failures.push(`${file}: ${rule.description}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('Git ignore policy covers known generated and runtime artifacts', async () => {
  const configured = await ignoreRules('.gitignore')
  const missing = requiredGitIgnoreRules.filter((rule) => !configured.has(rule))
  assert.deepEqual(missing, [])
})

test('Graphify ignore policy excludes tests, fixtures, and generated output', async () => {
  const configured = await ignoreRules('.graphifyignore')
  const missing = requiredGraphifyIgnoreRules.filter((rule) => !configured.has(rule))
  assert.deepEqual(missing, [])
})

test('screenshot workspace preparation recreates clean runtime state', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'datapadplusplus-screenshot-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const workspace = path.join(temporaryRoot, 'workspace')
  const staleFile = path.join(workspace, 'stale.json')

  prepareScreenshotWorkspace(workspace)
  await writeFile(staleFile, '{}')
  prepareScreenshotWorkspace(workspace)

  await access(workspace)
  await assert.rejects(access(staleFile), { code: 'ENOENT' })
})
