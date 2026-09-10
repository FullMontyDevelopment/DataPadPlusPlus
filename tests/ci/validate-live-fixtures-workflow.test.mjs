import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateLiveFixturesWorkflow } from './validate-live-fixtures-workflow.mjs'

test('current live fixture workflow keeps core and Oracle evidence isolated', () => {
  const result = validateLiveFixturesWorkflow(process.cwd())
  assert.match(result.path, /live-fixtures\.yml$/)
})

test('manual profiles and pull requests retain the intended fixture job routing', () => {
  const text = readFileSync(join(process.cwd(), '.github', 'workflows', 'live-fixtures.yml'), 'utf8')
  const core = text.split('  core-fixtures:')[1].split('\n  oracle-fixture:')[0]
  const oracle = text.split('  oracle-fixture:')[1]
  assert.match(core, /github\.event_name == 'pull_request'/)
  for (const profile of ['core', 'all']) assert.ok(core.includes(`github.event.inputs.profile == '${profile}'`))
  for (const profile of ['oracle', 'all']) assert.ok(oracle.includes(`github.event.inputs.profile == '${profile}'`))
  assert.ok(!oracle.includes("github.event_name == 'pull_request'"))
  assert.match(text, /default: core/)
})

test('failure artifacts cannot include workspace or secret-store files', () => {
  const text = readFileSync(join(process.cwd(), '.github', 'workflows', 'live-fixtures.yml'), 'utf8')
  const step = text.split('      - name: Upload desktop failure diagnostics')[1].split('\n      - name:')[0]
  assert.match(step, /if: failure\(\)/)
  assert.match(step, /include-hidden-files: true/)
  const paths = step.split('          path: |')[1].split('          if-no-files-found:')[0]
    .trim().split(/\r?\n/).map((line) => line.trim())
  assert.deepEqual(paths, [
    '${{ runner.temp }}/datapadplusplus-live-fixtures/.e2e-artifacts/',
    '${{ runner.temp }}/datapadplusplus-mcp-*/.e2e-artifacts/',
  ])
})

for (const [description, mutate, expected] of [
  ['scheduled trigger', (text) => text.replace('on:', "on:\n  schedule:\n    - cron: '17 2 * * 1-5'"), /must not run on a schedule/],
  ['stale schedule condition', (text) => text.replace("github.event_name == 'pull_request'", "github.event.schedule == '17 2 * * 1-5'"), /schedule-only job conditions/],
  ['missing manual dispatch', (text) => text.replace('  workflow_dispatch:', '  removed_dispatch:'), /manual profile selection/],
  ['missing pull-request trigger', (text) => text.replace('  pull_request:', '  removed_pull_request:'), /adapter or fixture code changes/],
]) {
  test(`live fixture workflow rejects ${description}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'datapad-live-workflow-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
    const current = readFileSync(join(process.cwd(), '.github', 'workflows', 'live-fixtures.yml'), 'utf8')
    writeFileSync(join(root, '.github', 'workflows', 'live-fixtures.yml'), mutate(current))
    assert.throws(() => validateLiveFixturesWorkflow(root), expected)
  })
}

for (const [description, mutate] of [
  ['missing sidecar preparation', (text) => text.replace('npm run oracle:sidecar:ensure', 'echo omitted')],
  ['sidecar preparation after Rust tests', (text) => text
    .replace('npm run oracle:sidecar:ensure', 'SWAP')
    .replace('npm run rust:test:fixtures:core', 'npm run oracle:sidecar:ensure')
    .replace('SWAP', 'npm run rust:test:fixtures:core')],
  ['missing core .NET installation', (text) => text.replace('uses: actions/setup-dotnet@', 'uses: missing/setup-dotnet@')],
  ['unfiltered optional-service tests', (text) => text.replace('rust:test:fixtures:core', 'rust:test:fixtures')],
  ['missing Linux linker library', (text) => text.replace('libxdo-dev', 'missing-library')],
  ['missing Linux keyring daemon', (text) => text.replace('gnome-keyring', 'missing-library')],
  ['missing Linux secret tools', (text) => text.replace('libsecret-tools', 'missing-library')],
  ['missing Linux D-Bus dependency', (text) => text.replace('dbus-x11', 'missing-library')],
  ['desktop execution without isolated D-Bus', (text) => text.replace('dbus-run-session -- ', '')],
  ['desktop execution without keyring setup', (text) => text.replace('bash apps/desktop/e2e/with-linux-keyring.sh ', '')],
]) {
  test(`live fixture workflow rejects ${description}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'datapad-live-workflow-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
    const current = readFileSync(join(process.cwd(), '.github', 'workflows', 'live-fixtures.yml'), 'utf8')
    writeFileSync(join(root, '.github', 'workflows', 'live-fixtures.yml'), mutate(current))
    assert.throws(() => validateLiveFixturesWorkflow(root), /Core fixtures must/)
  })
}

test('live fixture workflow validator rejects cleanup that is not unconditional', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-live-fixtures-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'live-fixtures.yml'),
    [
      'name: Live Fixture Validation',
      'on:',
      '  pull_request:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  core-fixtures:',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: core',
      '    steps:',
      '      - run: npm run fixtures:validate:postgres',
      '      - run: npm run fixtures:validate:mongodb',
      '      - run: npm run fixtures:validate:redis',
      '      - run: npm run rust:test:fixtures',
      '      - run: npm run e2e:desktop:build',
      '      - run: xvfb-run -a npm run e2e:desktop',
      '      - name: Stop fixtures',
      '        run: npm run fixtures:down',
      '  oracle-fixture:',
      '    steps:',
      '      - run: npm run fixtures:test:oracle',
      '      - name: Stop Oracle fixture',
      '        if: always()',
      '        run: npm run fixtures:stop:oracle',
    ].join('\n'),
  )

  assert.throws(
    () => validateLiveFixturesWorkflow(root),
    /unconditional cleanup/,
  )
})

test('live fixture workflow validator rejects runner context in job-level environment values', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-live-fixtures-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'live-fixtures.yml'),
    [
      'name: Live Fixture Validation',
      'on:',
      '  pull_request:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  core-fixtures:',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: core',
      '      DATAPADPLUSPLUS_WORKSPACE_DIR: ${{ runner.temp }}/live-fixtures',
      '    steps:',
      '      - run: npm run fixtures:validate:postgres',
      '      - run: npm run fixtures:validate:mongodb',
      '      - run: npm run fixtures:validate:redis',
      '      - run: npm run rust:test:fixtures',
      '      - run: npm run e2e:desktop:build',
      '      - run: xvfb-run -a npm run e2e:desktop',
      '      - name: Stop fixtures',
      '        if: always()',
      '        run: npm run fixtures:down',
      '  oracle-fixture:',
      '    steps:',
      '      - run: npm run fixtures:test:oracle',
      '      - name: Stop Oracle fixture',
      '        if: always()',
      '        run: npm run fixtures:stop:oracle',
    ].join('\n'),
  )

  assert.throws(
    () => validateLiveFixturesWorkflow(root),
    /runner context only after a runner starts/,
  )
})
