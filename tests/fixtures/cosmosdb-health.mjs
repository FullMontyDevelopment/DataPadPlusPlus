const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function readHealthStatus(fetchImpl, url) {
  try {
    const response = await fetchImpl(url)
    const body = await response.text()

    return {
      body,
      description: `${response.status} ${body}`,
      ready: response.ok,
    }
  } catch (error) {
    const description = error?.message ?? String(error)
    return { body: '', description, ready: false }
  }
}

function parseHealthBody(body) {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

export function isStuckCosmosDbHealth(body) {
  const health = parseHealthBody(body)

  return Boolean(
    health?.alive === true &&
      health?.ready === false &&
      health?.checks?.explorer === 'healthy' &&
      health?.checks?.gateway === 'healthy' &&
      health?.checks?.postgres === 'unhealthy',
  )
}

export async function waitForCosmosDbReady({
  healthPort,
  attempts = 90,
  delayMs = 1000,
  fetchImpl = globalThis.fetch,
  wait = sleep,
  recreate,
  allowRecovery = true,
  onRecovery = (message) => console.warn(message),
}) {
  const endpoint = `http://127.0.0.1:${healthPort}`
  let lastReadyStatus = { body: '', description: 'no response', ready: false }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastReadyStatus = await readHealthStatus(fetchImpl, `${endpoint}/ready`)

    if (lastReadyStatus.ready) {
      return
    }

    if (attempt + 1 < attempts) {
      await wait(delayMs)
    }
  }

  const aliveStatus = await readHealthStatus(fetchImpl, `${endpoint}/alive`)
  const hasStuckPostgres =
    isStuckCosmosDbHealth(lastReadyStatus.body) ||
    isStuckCosmosDbHealth(aliveStatus.body)

  if (allowRecovery && hasStuckPostgres && recreate) {
    onRecovery(
      'Cosmos DB emulator PostgreSQL remained unhealthy; recreating only the Cosmos DB fixture container and retrying once.',
    )
    await recreate()
    return waitForCosmosDbReady({
      healthPort,
      attempts,
      delayMs,
      fetchImpl,
      wait,
      recreate,
      allowRecovery: false,
      onRecovery,
    })
  }

  const recoveryStatus = allowRecovery
    ? 'The failure did not match the safe automatic-recovery signature.'
    : 'Automatic one-container recovery did not restore readiness.'

  throw new Error(
    [
      `Cosmos DB emulator container is running, but its health probe did not become ready on ${endpoint}/ready.`,
      `Last /ready response: ${lastReadyStatus.description}`,
      `Last /alive response: ${aliveStatus.description}`,
      recoveryStatus,
      'Recreate just this fixture container, then seed again:',
      '  docker compose --env-file tests/fixtures/.generated.env -f tests/fixtures/docker-compose.yml rm -sf cosmosdb',
      '  npm run fixtures:up:profile -- cosmosdb',
      '  npm run fixtures:seed:all',
    ].join('\n'),
  )
}

export async function waitForCosmosDbInitialization({
  check,
  attempts = 60,
  delayMs = 1000,
  wait = sleep,
}) {
  let lastDetail = 'no response'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check()

    if (result.ready) {
      return
    }

    lastDetail = result.detail || lastDetail

    if (attempt + 1 < attempts) {
      await wait(delayMs)
    }
  }

  throw new Error(
    [
      'Cosmos DB emulator became healthy, but its init script did not make the fixture database queryable.',
      `Last initialization response: ${lastDetail}`,
      'Inspect the emulator logs with:',
      '  docker logs datapadplusplus-cosmosdb',
    ].join('\n'),
  )
}
