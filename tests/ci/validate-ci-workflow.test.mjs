import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCiWorkflow } from './validate-ci-workflow'

test('current CI workflow only runs dependency-free checks', () => {
  const result = validateCiWorkflow(process.cwd())

  assert.match(result.path, /\.github[\\/]+workflows[\\/]+ci\.yml$/)
})

test('CI workflow validator rejects fixture and E2E jobs', () => {
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
      '      - run: docker compose up -d --wait',
      '      - run: npm run check:e2e',
    ].join('\n'),
  )

  assert.throws(() => validateCiWorkflow(root), /Docker fixtures/)
})
