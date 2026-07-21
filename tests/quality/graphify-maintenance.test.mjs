import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  addNoBackupPolicy,
  patchGraphifyHookFile,
  pruneGraphifyBackups,
} from '../../tools/graphify-maintenance.mjs'

const commitMarkers = {
  start: '# graphify-hook-start',
  end: '# graphify-hook-end',
}

async function exists(candidate) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

test('Graphify backup pruning removes only valid direct dated directories', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'datapadplusplus-graphify-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  const removable = path.join(temporaryRoot, '2026-07-21')
  const invalidDate = path.join(temporaryRoot, '2026-99-99')
  const similarName = path.join(temporaryRoot, '2026-07-21-notes')
  const liveGraph = path.join(temporaryRoot, 'graph.json')
  await mkdir(removable)
  await mkdir(invalidDate)
  await mkdir(similarName)
  await writeFile(path.join(removable, 'graph.json'), '{}')
  await writeFile(liveGraph, '{}')

  assert.deepEqual(await pruneGraphifyBackups(temporaryRoot), ['2026-07-21'])
  assert.equal(await exists(removable), false)
  assert.equal(await exists(invalidDate), true)
  assert.equal(await exists(similarName), true)
  assert.equal(await exists(liveGraph), true)
})

test('Graphify no-backup policy is idempotent and stays inside its hook block', () => {
  const original = [
    '#!/bin/sh',
    'echo before',
    commitMarkers.start,
    'export PYTHONHASHSEED=0',
    commitMarkers.end,
    'echo after',
    '',
  ].join('\n')

  const once = addNoBackupPolicy(original, commitMarkers)
  const twice = addNoBackupPolicy(once, commitMarkers)

  assert.equal(twice, once)
  assert.equal((once.match(/export GRAPHIFY_NO_BACKUP=1/g) ?? []).length, 1)
  assert.match(once, /^#!\/bin\/sh\necho before\n/)
  assert.match(once, /# graphify-hook-end\necho after\n$/)
})

test('Graphify hook patching preserves unrelated hook content', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'datapadplusplus-hook-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const hookPath = path.join(temporaryRoot, 'post-commit')
  const original = [
    '#!/bin/sh',
    'custom-tool before',
    commitMarkers.start,
    'export PYTHONHASHSEED=0',
    commitMarkers.end,
    'custom-tool after',
    '',
  ].join('\n')
  await writeFile(hookPath, original)

  assert.equal(await patchGraphifyHookFile(hookPath, commitMarkers), true)
  assert.equal(await patchGraphifyHookFile(hookPath, commitMarkers), false)

  const patched = await readFile(hookPath, 'utf8')
  assert.match(patched, /custom-tool before/)
  assert.match(patched, /custom-tool after/)
  assert.match(patched, /export GRAPHIFY_NO_BACKUP=1/)
})
