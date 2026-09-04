import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCiWorkflow } from './validate-ci-workflow.mjs'

test('current CI workflow keeps its deterministic job dependency-free', () => {
  const result = validateCiWorkflow(process.cwd())

  assert.match(result.path, /\.github[\\/]+workflows[\\/]+ci\.yml$/)
})

test('CI workflow validator rejects fixture and E2E steps in the deterministic job', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-ci-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    [
      'name: CI',
      'on:',
      '  pull_request:',
      '  push:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  deterministic-tests:',
      '    name: Unit and dependency-free integration tests',
      '    runs-on: ubuntu-22.04',
      '    env:',
      "      DATAPADPLUSPLUS_FIXTURE_RUN: '0'",
      '    steps:',
      '      - run: npm run ci:test',
      '      - run: node tests/ci/write-test-summary.mjs',
      '      - run: docker compose up -d --wait',
      '      - run: npm run check:e2e',
      '  native-smoke:',
      '    runs-on: windows-latest',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: sqlite-smoke',
      '    steps:',
      '      - run: npm run e2e:desktop:build',
      '      - run: npm run e2e:desktop:smoke',
    ].join('\n'),
  )

  assert.throws(() => validateCiWorkflow(root), /Docker fixtures/)
})

test('CI workflow validator allows isolated native and fixture jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-ci-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    [
      'name: CI',
      'on:',
      '  pull_request:',
      '  push:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  deterministic-tests:',
      '    name: Unit and dependency-free integration tests',
      '    runs-on: ubuntu-22.04',
      '    env:',
      "      DATAPADPLUSPLUS_FIXTURE_RUN: '0'",
      '    steps:',
      '      - run: npm run ci:test',
      '      - run: node tests/ci/write-test-summary.mjs',
      '  fixture-tests:',
      '    runs-on: ubuntu-22.04',
      '    steps:',
      '      - run: docker compose up -d --wait',
      '      - run: npm run check:e2e',
      '  native-smoke:',
      '    runs-on: windows-latest',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: sqlite-smoke',
      '    steps:',
      '      - run: npm run e2e:desktop:build',
      '      - run: npm run e2e:desktop:smoke',
    ].join('\n'),
  )

  assert.doesNotThrow(() => validateCiWorkflow(root))
})

test('CI workflow validator rejects Docker in the native SQLite smoke job', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-ci-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    [
      'name: CI',
      'on:',
      '  pull_request:',
      '  push:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  deterministic-tests:',
      '    name: Unit and dependency-free integration tests',
      '    runs-on: ubuntu-22.04',
      '    env:',
      "      DATAPADPLUSPLUS_FIXTURE_RUN: '0'",
      '    steps:',
      '      - run: npm run ci:test',
      '      - run: node tests/ci/write-test-summary.mjs',
      '  native-smoke:',
      '    runs-on: windows-latest',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: sqlite-smoke',
      '    steps:',
      '      - run: npm run e2e:desktop:build',
      '      - run: docker compose up -d',
      '      - run: npm run e2e:desktop:smoke',
    ].join('\n'),
  )

  assert.throws(() => validateCiWorkflow(root), /must not start Docker fixtures/)
})

test('CI workflow validator rejects runner context in job-level environment values', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-ci-'))
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    [
      'name: CI',
      'on:',
      '  pull_request:',
      '  push:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  deterministic-tests:',
      '    name: Unit and dependency-free integration tests',
      '    runs-on: ubuntu-22.04',
      '    env:',
      "      DATAPADPLUSPLUS_FIXTURE_RUN: '0'",
      '    steps:',
      '      - run: npm run ci:test',
      '      - run: node tests/ci/write-test-summary.mjs',
      '  native-smoke:',
      '    runs-on: windows-latest',
      '    env:',
      '      DATAPADPLUSPLUS_FIXTURE_PROFILE: sqlite-smoke',
      '      DATAPADPLUSPLUS_WORKSPACE_DIR: ${{ runner.temp }}/native-smoke',
      '    steps:',
      '      - run: npm run e2e:desktop:build',
      '      - run: npm run e2e:desktop:smoke',
    ].join('\n'),
  )

  assert.throws(() => validateCiWorkflow(root), /runner context only after a runner starts/)
})

test('CI scripts use Node-compatible explicit ESM import specifiers', () => {
  const ciDir = join(process.cwd(), 'tests', 'ci')
  const failures = []

  for (const fileName of readdirSync(ciDir)) {
    if (!fileName.endsWith('.mjs')) continue

    const source = readFileSync(join(ciDir, fileName), 'utf8')
    const imports = [
      ...source.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g),
      ...source.matchAll(/import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)
    ]

    for (const match of imports) {
      if (!/\.(?:mjs|js|json)$/.test(match[1])) {
        failures.push(`${fileName}: ${match[1]}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})
