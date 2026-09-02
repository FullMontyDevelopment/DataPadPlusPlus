import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const suiteArgument = process.argv.find((argument) => argument.startsWith('--suite='))
const suite =
  suiteArgument?.slice('--suite='.length) ||
  process.env.DATAPADPLUSPLUS_E2E_SUITE ||
  'fixtures'
const supportedSuites = new Set(['fixtures', 'smoke'])

if (!supportedSuites.has(suite)) {
  throw new Error(`Unknown DataPad++ desktop E2E suite: ${suite}`)
}

const workspaceDir =
  process.env.DATAPADPLUSPLUS_WORKSPACE_DIR ??
  mkdtempSync(join(tmpdir(), 'datapadplusplus-e2e-workspace-'))
const desktopEnvironment = {
  ...process.env,
  DATAPADPLUSPLUS_E2E_SUITE: suite,
  DATAPADPLUSPLUS_FIXTURE_RUN: process.env.DATAPADPLUSPLUS_FIXTURE_RUN ?? '1',
  DATAPADPLUSPLUS_FIXTURE_PROFILE:
    process.env.DATAPADPLUSPLUS_FIXTURE_PROFILE ??
    (suite === 'smoke' ? 'sqlite-smoke' : ''),
  DATAPADPLUSPLUS_WORKSPACE_DIR: workspaceDir,
  DATAPADPLUSPLUS_SECRET_STORE: 'file',
  DATAPADPLUSPLUS_SECRET_FILE: join(workspaceDir, 'secrets.json'),
  DATAPADPLUSPLUS_SQLITE_FIXTURE: resolve(
    repoRoot,
    'tests',
    'fixtures',
    'sqlite',
    'datapadplusplus.sqlite3',
  ),
}

function prepareSqliteFixture() {
  if (suite !== 'smoke' || process.env.DATAPADPLUSPLUS_E2E_PREPARE_SQLITE === '0') {
    return
  }

  const script = resolve(repoRoot, 'tests', 'fixtures', 'sqlite', 'seed.py')
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : process.platform === 'win32'
      ? [['py', ['-3']], ['python', []], ['python3', []]]
      : [['python3', []], ['python', []]]

  for (const [command, prefixArgs] of candidates) {
    const probe = spawnSync(command, [...prefixArgs, '--version'], {
      encoding: 'utf8',
      stdio: 'ignore',
      shell: false,
    })
    if (probe.status !== 0) {
      continue
    }

    const seeded = spawnSync(command, [...prefixArgs, script], {
      cwd: repoRoot,
      env: desktopEnvironment,
      stdio: 'inherit',
      shell: false,
    })
    if (seeded.error) {
      throw seeded.error
    }
    if (seeded.status !== 0) {
      throw new Error(`SQLite fixture preparation failed with exit code ${seeded.status}`)
    }
    return
  }

  throw new Error('Python 3 is required to prepare the SQLite desktop E2E fixture.')
}

function candidateBinaries() {
  const releaseDir = resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'release')

  if (process.platform === 'win32') {
    return [
      join(releaseDir, 'datapadplusplus-desktop.exe'),
      join(releaseDir, 'DataPad++.exe'),
    ]
  }

  if (process.platform === 'darwin') {
    return [
      join(releaseDir, 'bundle', 'macos', 'DataPad++.app'),
      join(releaseDir, 'datapadplusplus-desktop'),
    ]
  }

  return [
    join(releaseDir, 'datapadplusplus-desktop'),
    join(releaseDir, 'bundle', 'appimage', 'DataPad++.AppImage'),
  ]
}

function resolveApplicationBinary() {
  if (process.env.DATAPADPLUSPLUS_DESKTOP_BINARY) {
    return resolve(process.env.DATAPADPLUSPLUS_DESKTOP_BINARY)
  }

  const binary = candidateBinaries().find((candidate) => existsSync(candidate))

  if (!binary) {
    throw new Error(
      [
        'Unable to find a built DataPad++ desktop binary.',
        'Run `npm run tauri:build` or the documented no-bundle Tauri E2E build, then set DATAPADPLUSPLUS_DESKTOP_BINARY if needed.',
      ].join(' '),
    )
  }

  return binary
}

function runWdio(application) {
  const wdioCli = resolve(repoRoot, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js')
  const configPath = resolve(repoRoot, 'apps', 'desktop', 'e2e', 'wdio.conf.mjs')
  const result = spawnSync(
    process.execPath,
    [
      wdioCli,
      'run',
      configPath,
    ],
    {
      cwd: tmpdir(),
      env: {
        ...desktopEnvironment,
        DATAPADPLUSPLUS_DESKTOP_BINARY: application,
      },
      stdio: 'inherit',
      shell: false,
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Desktop E2E failed with exit code ${result.status}`)
  }
}

const application = resolveApplicationBinary()
prepareSqliteFixture()

try {
  runWdio(application)
} finally {
  if (!process.env.DATAPADPLUSPLUS_WORKSPACE_DIR) {
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}
