import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  extractOptimizedDependencyUrls,
  inspectUiServer,
} from '../../.vscode/ensure-ui-dev.mjs'

import {
  oracleSidecarNeedsBuild,
} from './oracle-sidecar-config.mjs'
import { ensureOracleSidecar } from './ensure-oracle-sidecar.mjs'

const root = resolve(import.meta.dirname, '..', '..')

test('every VS Code Rust debug build targets only the desktop executable', async () => {
  const launch = readJsonc(join(root, '.vscode', 'launch.json'))
  const tasks = readJsonc(join(root, '.vscode', 'tasks.json'))

  const lldbConfigurations = launch.configurations.filter((configuration) => configuration.type === 'lldb')
  assert.ok(lldbConfigurations.length > 0)
  for (const configuration of lldbConfigurations) {
    assert.deepEqual(
      configuration.cargo.args.slice(-2),
      ['--bin', 'datapadplusplus-desktop'],
      configuration.name,
    )
  }

  const rustBuild = tasks.tasks.find((task) => task.label === 'datapadplusplus:rust:build')
  assert.deepEqual(rustBuild.args.slice(-2), ['--bin', 'datapadplusplus-desktop'])
  assert.ok(
    tasks.tasks.some((task) => task.label === 'datapadplusplus:oracle:ensure'),
    'The debug task graph must ensure the ignored Oracle sidecar exists.',
  )
})

test('Tauri dev reuses only a verified DataPad++ UI server', () => {
  const tauri = JSON.parse(
    readFileSync(resolve(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  )
  const desktopPackage = JSON.parse(
    readFileSync(resolve(root, 'apps', 'desktop', 'package.json'), 'utf8'),
  )
  const ensureUi = readFileSync(resolve(root, '.vscode', 'ensure-ui-dev.mjs'), 'utf8')
  const viteConfig = readFileSync(resolve(root, 'apps', 'desktop', 'vite.config.ts'), 'utf8')

  assert.match(tauri.build.beforeDevCommand, /npm run dev:ensure/)
  assert.equal(desktopPackage.scripts['dev:ensure'], 'node ../../.vscode/ensure-ui-dev.mjs')
  assert.match(ensureUi, /<title>DataPad\+\+<\/title>/)
  assert.match(ensureUi, /extractOptimizedDependencyUrls/)
  assert.match(ensureUi, /datapad-stale/)
  assert.match(ensureUi, /process\.kill\(initialState\.pid/)
  assert.doesNotMatch(ensureUi, /cmd\.exe/)
  assert.match(ensureUi, /Port \$\{port\} is occupied by another application/)
  assert.match(ensureUi, /windowsHide: true/)
  assert.match(viteConfig, /ignored: \['\*\*\/src-tauri\/\*\*'\]/)
})

test('UI health rejects a DataPad++ server with stale optimized dependencies', async () => {
  const entry = `
    import react from "/node_modules/.vite/deps/react.js?v=abc123"
    import { App } from "/src/app/App.tsx"
  `
  const responses = new Map([
    ['http://127.0.0.1:1420/', response(200, '<title>DataPad++</title>')],
    ['http://127.0.0.1:1420/@vite/client', response(200, 'vite')],
    ['http://127.0.0.1:1420/src/main.tsx', response(200, entry)],
    [
      'http://127.0.0.1:1420/__datapad_dev_server',
      response(200, JSON.stringify({ app: 'datapadplusplus-desktop', pid: 4242 })),
    ],
    ['http://127.0.0.1:1420/node_modules/.vite/deps/react.js?v=abc123', response(504, '')],
  ])

  const state = await inspectUiServer({
    connect: async () => true,
    read: async (url) => responses.get(url),
  })

  assert.deepEqual(state, { kind: 'datapad-stale', pid: 4242 })
})

test('UI health accepts only an executable DataPad++ entry graph', async () => {
  const entry = `
    import react from "/node_modules/.vite/deps/react.js?v=abc123"
    import reactAgain from "/node_modules/.vite/deps/react.js?v=abc123"
  `
  assert.deepEqual(extractOptimizedDependencyUrls(entry), [
    'http://127.0.0.1:1420/node_modules/.vite/deps/react.js?v=abc123',
  ])

  const responses = new Map([
    ['http://127.0.0.1:1420/', response(200, '<title>DataPad++</title>')],
    ['http://127.0.0.1:1420/@vite/client', response(200, 'vite')],
    ['http://127.0.0.1:1420/src/main.tsx', response(200, entry)],
    [
      'http://127.0.0.1:1420/__datapad_dev_server',
      response(200, JSON.stringify({ app: 'datapadplusplus-desktop', pid: 4242 })),
    ],
    ['http://127.0.0.1:1420/node_modules/.vite/deps/react.js?v=abc123', response(200, 'react')],
  ])

  const state = await inspectUiServer({
    connect: async () => true,
    read: async (url) => responses.get(url),
  })

  assert.deepEqual(state, { kind: 'datapad-ready', pid: 4242 })
})

test('the static boot surface cannot remain in a starting state forever', () => {
  const indexHtml = readFileSync(resolve(root, 'apps', 'desktop', 'index.html'), 'utf8')

  assert.match(indexHtml, /window\.setTimeout\(showStartupError, 20000\)/)
  assert.match(indexHtml, /could not finish starting/)
  assert.match(indexHtml, /HTMLScriptElement/)
})

function response(statusCode, body) {
  return { statusCode, body }
}

test('Oracle sidecar ensure skips current outputs and rebuilds stale outputs', () => {
  const fixture = createSidecarFixture()
  try {
    assert.equal(oracleSidecarNeedsBuild(fixture.context), true)
    writeOutput(fixture, 20)
    assert.equal(oracleSidecarNeedsBuild(fixture.context), false)

    let prepares = 0
    const current = ensureOracleSidecar({
      context: fixture.context,
      prepare: () => { prepares += 1 },
    })
    assert.equal(current.prepared, false)
    assert.equal(prepares, 0)

    setTime(fixture.source, 30)
    const stale = ensureOracleSidecar({
      context: fixture.context,
      prepare: () => {
        prepares += 1
        writeOutput(fixture, 40)
      },
    })
    assert.equal(stale.prepared, true)
    assert.equal(prepares, 1)
    assert.equal(existsSync(fixture.context.lockDir), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Oracle sidecar ensure waits for a concurrent preparation result', () => {
  const fixture = createSidecarFixture()
  try {
    mkdirSync(fixture.context.lockDir, { recursive: true })
    let waits = 0
    const result = ensureOracleSidecar({
      context: fixture.context,
      now: () => 1_000,
      sleep: () => {
        waits += 1
        writeOutput(fixture, 20)
        rmSync(fixture.context.lockDir, { recursive: true, force: true })
      },
      prepare: () => assert.fail('The waiting process must reuse the concurrent output.'),
    })
    assert.equal(result.prepared, false)
    assert.equal(waits, 1)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Oracle preparation explains the missing .NET 8 prerequisite', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'datapad-oracle-missing-dotnet-'))
  try {
    const result = spawnSync(process.execPath, [join(root, 'tests', 'release', 'prepare-oracle-sidecar.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATAPADPLUSPLUS_DOTNET: join(fixtureRoot, 'missing-dotnet'),
        DATAPADPLUSPLUS_ORACLE_ROOT: fixtureRoot,
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires the \.NET 8 SDK/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

function createSidecarFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'datapad-oracle-ensure-'))
  const sidecarRoot = join(fixtureRoot, 'sidecar')
  const source = join(sidecarRoot, 'Program.cs')
  const prepareScript = join(fixtureRoot, 'prepare.mjs')
  const configScript = join(fixtureRoot, 'config.mjs')
  const destination = join(fixtureRoot, 'bin', 'oracle.exe')
  const licenseDestination = join(fixtureRoot, 'licenses', 'LICENSE.txt')
  mkdirSync(sidecarRoot, { recursive: true })
  writeFileSync(source, 'source')
  writeFileSync(prepareScript, 'prepare')
  writeFileSync(configScript, 'config')
  setTime(source, 10)
  setTime(prepareScript, 10)
  setTime(configScript, 10)

  return {
    root: fixtureRoot,
    source,
    destination,
    licenseDestination,
    context: {
      rid: 'win-x64',
      sidecarRoot,
      destination,
      licenseDestination,
      prepareScript,
      configScript,
      lockDir: join(sidecarRoot, '.ensure.lock'),
    },
  }
}

function writeOutput(fixture, timestamp) {
  mkdirSync(join(fixture.root, 'bin'), { recursive: true })
  mkdirSync(join(fixture.root, 'licenses'), { recursive: true })
  writeFileSync(fixture.destination, 'binary')
  writeFileSync(fixture.licenseDestination, 'license')
  setTime(fixture.destination, timestamp)
  setTime(fixture.licenseDestination, timestamp)
}

function setTime(path, seconds) {
  utimesSync(path, seconds, seconds)
}

function readJsonc(path) {
  const source = readFileSync(path, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(source)
}
