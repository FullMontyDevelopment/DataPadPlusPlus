import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const container = 'datapadplusplus-cosmosdb'
const checks = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function generatedEnvValue(key) {
  const generatedEnvPath = path.join(process.cwd(), 'tests', 'fixtures', '.generated.env')
  if (!existsSync(generatedEnvPath)) {
    return undefined
  }

  const line = readFileSync(generatedEnvPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${key}=`))

  return line?.slice(key.length + 1).trim()
}

function fixturePort(key, fallback) {
  const value = process.env[key] ?? generatedEnvValue(key) ?? String(fallback)
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${key} must be a positive integer port, got ${JSON.stringify(value)}`)
  }
  return port
}

function cosmosShell(command) {
  const result = docker(['exec', container, 'cosmoshell.sh', '-c', command])
  if (result.status !== 0) {
    throw new Error(
      `cosmoshell.sh -c ${JSON.stringify(command)} failed: ${result.stderr || result.stdout}`,
    )
  }
  return result.stdout
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function expectOutput(output, pattern, label) {
  if (!pattern.test(output)) {
    throw new Error(`${label} expected ${pattern}, got:\n${output}`)
  }
}

async function waitForReady() {
  const port = fixturePort('DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT', 18082)
  let lastError

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/ready`)
      if (response.ok) {
        return
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Timed out waiting for Cosmos DB emulator health endpoint on ${port}: ${
      lastError?.message ?? 'unknown error'
    }`,
  )
}

if (!containerRunning(container)) {
  throw new Error(
    'Cosmos DB emulator fixture is not running. Start it with `npm run fixtures:up:profile -- cosmosdb`, then rerun this validator.',
  )
}

await record('Cosmos DB emulator: health endpoint ready', waitForReady)

await record('Cosmos DB emulator: seeded database is visible', () => {
  const output = cosmosShell('ls')
  expectOutput(output, /datapadplusplus/i, 'database list')
})

await record('Cosmos DB emulator: seeded containers are visible', () => {
  const output = cosmosShell('cd datapadplusplus; ls')
  expectOutput(output, /accounts/i, 'container list')
  expectOutput(output, /products/i, 'container list')
  expectOutput(output, /orders/i, 'container list')
  expectOutput(output, /order_events/i, 'container list')
})

await record('Cosmos DB emulator: seeded order query returns document evidence', () => {
  const output = cosmosShell(
    'query "SELECT * FROM c WHERE c.id = \'order-101\'" --database=datapadplusplus --container=orders',
  )
  expectOutput(output, /order-101/i, 'order query')
  expectOutput(output, /processing/i, 'order query')
  expectOutput(output, /luna-lamp/i, 'order query')
})

await record('Cosmos DB emulator: seeded product query returns document evidence', () => {
  const output = cosmosShell(
    'query "SELECT * FROM c WHERE c.sku = \'luna-lamp\'" --database=datapadplusplus --container=products',
  )
  expectOutput(output, /luna-lamp/i, 'product query')
  expectOutput(output, /lighting/i, 'product query')
})

await record('Cosmos DB emulator: count query returns seeded volume', () => {
  const output = cosmosShell(
    'query "SELECT VALUE COUNT(1) FROM c" --database=datapadplusplus --container=orders',
  )
  expect(/[3-9]\d*/.test(output), `orders count query did not show seeded rows:\n${output}`)
})

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error?.stack ?? check.error)
  }
}

if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log('Cosmos DB emulator fixture validation passed.')
}
