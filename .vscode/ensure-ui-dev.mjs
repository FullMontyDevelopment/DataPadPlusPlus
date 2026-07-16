import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(__dirname, '..')
const desktopRoot = resolve(workspaceRoot, 'apps', 'desktop')
const viteBin = resolve(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const host = '127.0.0.1'
const port = 1420
const appUrl = `http://${host}:${port}/`
const viteClientUrl = `${appUrl}@vite/client`
const entryUrl = `${appUrl}src/main.tsx`
const identityUrl = `${appUrl}__datapad_dev_server`
const appMarker = '<title>DataPad++</title>'
const identityMarker = 'datapadplusplus-desktop'
const readyTimeoutMs = 30000
const staleRecoveryMs = 3000
const logPath = resolve(workspaceRoot, '.vscode', 'ui-dev.log')

export function extractOptimizedDependencyUrls(entrySource) {
  const matches = entrySource.matchAll(
    /["'](\/node_modules\/\.vite\/deps\/[^"']+)["']/g,
  )
  return [...new Set([...matches].map((match) => new URL(match[1], appUrl).href))]
}

export async function inspectUiServer({
  connect = canConnect,
  read = readHttp,
} = {}) {
  if (!(await connect())) {
    return { kind: 'free' }
  }

  const [viteClient, app, entry, identity] = await Promise.all([
    read(viteClientUrl),
    read(appUrl),
    read(entryUrl),
    read(identityUrl),
  ])
  const isDataPad =
    viteClient?.statusCode === 200 &&
    app?.statusCode === 200 &&
    app.body.includes(appMarker)
  if (!isDataPad) {
    return { kind: 'occupied' }
  }

  const pid = parseIdentityPid(identity)
  if (entry?.statusCode !== 200) {
    return { kind: 'datapad-stale', pid }
  }

  const dependencyUrls = extractOptimizedDependencyUrls(entry.body)
  if (dependencyUrls.length === 0) {
    return { kind: 'datapad-stale', pid }
  }

  const dependencies = await Promise.all(dependencyUrls.map((url) => read(url)))
  if (dependencies.some((dependency) => dependency?.statusCode !== 200)) {
    return { kind: 'datapad-stale', pid }
  }

  return { kind: 'datapad-ready', pid }
}

function canConnect() {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port })

    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.end()
      resolvePromise(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolvePromise(false)
    })
    socket.once('error', () => {
      resolvePromise(false)
    })
  })
}

function readHttp(url) {
  return new Promise((resolvePromise) => {
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        settle({ statusCode: response.statusCode, body })
      })
    })

    request.setTimeout(5000, () => {
      request.destroy()
      settle(undefined)
    })
    request.once('error', () => {
      settle(undefined)
    })
  })
}

function parseIdentityPid(response) {
  if (response?.statusCode !== 200) return undefined

  try {
    const identity = JSON.parse(response.body)
    return identity?.app === identityMarker &&
      Number.isSafeInteger(identity.pid) &&
      identity.pid > 0
      ? identity.pid
      : undefined
  } catch {
    return undefined
  }
}

async function waitForState(expectedKind, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const state = await inspectUiServer()
    if (state.kind === expectedKind) return state
    await delay(250)
  }

  return undefined
}

async function recoverStaleServer(initialState) {
  const recovered = await waitForState('datapad-ready', staleRecoveryMs)
  if (recovered) return true

  if (!initialState.pid) {
    console.error(
      `A stale DataPad++ UI server is listening on port ${port}, but it predates automatic recovery. Stop it once, then retry.`,
    )
    return false
  }

  console.log(`Restarting stale DataPad++ UI server on port ${port}...`)
  try {
    process.kill(initialState.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.error(`Could not stop stale DataPad++ UI server: ${error.message}`)
      return false
    }
  }

  if (!(await waitForState('free', 5000))) {
    console.error(`Stale DataPad++ UI server on port ${port} did not stop.`)
    return false
  }
  return true
}

function startVite() {
  const logFd = openSync(logPath, 'a')
  const child = spawn(
    process.execPath,
    [viteBin, '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: desktopRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    },
  )
  closeSync(logFd)
  child.unref()
  return child
}

function stopChild(child) {
  if (!child.killed) {
    child.kill('SIGTERM')
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function main() {
  let initialState = await inspectUiServer()
  if (initialState.kind === 'datapad-ready') {
    console.log(`DataPad++ UI ready at ${appUrl}`)
    return
  }
  if (initialState.kind === 'occupied') {
    throw new Error(
      `Port ${port} is occupied by another application. Stop that application before starting DataPad++ development.`,
    )
  }
  if (initialState.kind === 'datapad-stale') {
    if (!(await recoverStaleServer(initialState))) process.exit(1)
    initialState = await inspectUiServer()
  }

  if (initialState.kind !== 'free') {
    throw new Error(`Port ${port} did not become available for DataPad++ development.`)
  }

  const child = startVite()
  child.once('error', (error) => {
    console.error(error)
    process.exit(1)
  })
  process.once('SIGINT', () => stopChild(child))
  process.once('SIGTERM', () => stopChild(child))

  if (!(await waitForState('datapad-ready', readyTimeoutMs))) {
    stopChild(child)
    throw new Error(`DataPad++ UI dev server did not become ready at ${appUrl}`)
  }

  console.log(`DataPad++ UI ready at ${appUrl}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
