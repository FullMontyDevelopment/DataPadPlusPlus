import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  oracleSidecarNeedsBuild,
  resolveOracleSidecarContext,
} from './oracle-sidecar-config.mjs'

const lockPollMs = 250
const lockTimeoutMs = 120_000
const staleLockMs = 10 * 60_000

export function ensureOracleSidecar({
  context = resolveOracleSidecarContext(),
  env = process.env,
  now = () => Date.now(),
  sleep = sleepSync,
  prepare = () => runPrepare(context, env),
} = {}) {
  if (!oracleSidecarNeedsBuild(context)) {
    console.log(`Oracle sidecar is current (${context.rid}): ${context.destination}`)
    return { prepared: false, destination: context.destination }
  }

  const startedAt = now()
  while (!tryAcquireLock(context.lockDir)) {
    if (!oracleSidecarNeedsBuild(context)) {
      return { prepared: false, destination: context.destination }
    }
    removeStaleLock(context.lockDir, now())
    if (now() - startedAt >= lockTimeoutMs) {
      throw new Error(
        `Timed out waiting for another Oracle sidecar preparation to finish (${context.lockDir}).`,
      )
    }
    sleep(lockPollMs)
  }

  try {
    if (!oracleSidecarNeedsBuild(context)) {
      return { prepared: false, destination: context.destination }
    }
    prepare()
    if (oracleSidecarNeedsBuild(context)) {
      throw new Error('Oracle sidecar preparation completed without producing current outputs.')
    }
    return { prepared: true, destination: context.destination }
  } finally {
    rmSync(context.lockDir, { recursive: true, force: true })
  }
}

function runPrepare(context, env) {
  try {
    execFileSync(process.execPath, [context.prepareScript], {
      cwd: context.root,
      env,
      stdio: 'inherit',
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'Oracle sidecar preparation requires the .NET 8 SDK. Install it or restore a current generated sidecar binary before debugging.',
      )
    }
    throw error
  }
}

function tryAcquireLock(lockDir) {
  try {
    mkdirSync(lockDir, { recursive: false })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

function removeStaleLock(lockDir, currentTime) {
  try {
    if (currentTime - statSync(lockDir).mtimeMs > staleLockMs) {
      rmSync(lockDir, { recursive: true, force: true })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureOracleSidecar()
}
