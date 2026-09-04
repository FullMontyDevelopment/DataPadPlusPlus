import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateLiveFixturesWorkflow } from './validate-live-fixtures-workflow.mjs'

test('current live fixture workflow keeps core and Oracle evidence isolated', () => {
  const result = validateLiveFixturesWorkflow(process.cwd())
  assert.match(result.path, /live-fixtures\.yml$/)
})

test('live fixture workflow validator rejects cleanup that is not unconditional', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-live-fixtures-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'live-fixtures.yml'),
    [
      'name: Live Fixture Validation',
      'on:',
      '  pull_request:',
      '  schedule:',
      "    - cron: '17 2 * * 1-5'",
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
      '  schedule:',
      "    - cron: '17 2 * * 1-5'",
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
