import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const targets = {
  'win-x64': {
    host: 'win32-x64',
    name: 'datapadplusplus-oracle-runtime-x86_64-pc-windows-msvc.exe',
  },
  'linux-x64': {
    host: 'linux-x64',
    name: 'datapadplusplus-oracle-runtime-x86_64-unknown-linux-gnu',
  },
  'osx-arm64': {
    host: 'darwin-arm64',
    name: 'datapadplusplus-oracle-runtime-aarch64-apple-darwin',
  },
}
const hostTargets = Object.fromEntries(Object.entries(targets).map(([rid, value]) => [value.host, rid]))
const hostKey = `${process.platform}-${process.arch}`
const rid = process.env.DATAPADPLUSPLUS_ORACLE_RID || hostTargets[hostKey]
const target = targets[rid]

if (!target) {
  throw new Error(`Oracle sidecar smoke testing is not configured for ${rid || hostKey}.`)
}
if (target.host !== hostKey) {
  throw new Error(`Oracle runtime ${rid} cannot be executed on ${hostKey}; use its native CI runner.`)
}

const runtime = resolve(
  process.argv[2] || join(root, 'apps', 'desktop', 'src-tauri', 'binaries', target.name),
)
if (!existsSync(runtime)) {
  throw new Error(`Bundled Oracle runtime is missing at ${runtime}.`)
}
if (process.platform !== 'win32') {
  accessSync(runtime, constants.X_OK)
}

const child = spawn(runtime, [], {
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
const lines = createInterface({ input: child.stdout })
let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-2_000)
})

const response = await new Promise((resolveResponse, reject) => {
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error('Oracle runtime health handshake timed out.'))
  }, 10_000)

  child.once('error', (error) => {
    clearTimeout(timeout)
    reject(new Error(`Oracle runtime could not start: ${error.code || error.message}`))
  })
  child.once('exit', (code) => {
    clearTimeout(timeout)
    reject(new Error(`Oracle runtime exited before health completed (code ${code}).`))
  })
  lines.once('line', (line) => {
    clearTimeout(timeout)
    try {
      resolveResponse(JSON.parse(line))
    } catch {
      reject(new Error('Oracle runtime returned an invalid health response.'))
    }
  })

  child.stdin.write(`${JSON.stringify({
    protocolVersion: 1,
    requestId: 'release-health',
    operation: 'health',
  })}\n`)
})

child.stdin.end()
await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error('Oracle runtime did not exit after its input pipe closed.'))
  }, 5_000)
  child.once('exit', (code) => {
    clearTimeout(timeout)
    if (code === 0) resolveExit()
    else reject(new Error(`Oracle runtime health process exited with code ${code}.`))
  })
})

if (!response?.ok || response.requestId !== 'release-health') {
  throw new Error(`Oracle runtime health failed with ${response?.code || 'invalid-response'}.`)
}
const health = response.result
if (
  health?.protocolVersion !== 1
  || typeof health.runtimeVersion !== 'string'
  || typeof health.driverVersion !== 'string'
  || health.targetPlatform !== rid
) {
  throw new Error(`Oracle runtime returned incomplete or mismatched health metadata for ${rid}.`)
}
if (process.platform === 'win32' && health.consoleAttached !== false) {
  throw new Error('Windows Oracle runtime attached a console during its hidden health check.')
}
if (stderr.trim()) {
  throw new Error('Oracle runtime wrote unexpected diagnostics during its health check.')
}

console.log(
  `Oracle runtime health OK (${health.targetPlatform}, ${health.runtimeVersion}, driver ${health.driverVersion}).`,
)
