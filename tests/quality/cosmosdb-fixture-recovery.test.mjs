import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isStuckCosmosDbHealth,
  waitForCosmosDbInitialization,
  waitForCosmosDbReady,
} from '../fixtures/cosmosdb-health.mjs'

const stuckHealth = {
  alive: true,
  checks: {
    explorer: 'healthy',
    gateway: 'healthy',
    postgres: 'unhealthy',
  },
  ready: false,
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

test('recognizes only the bounded Cosmos PostgreSQL failure signature', () => {
  assert.equal(isStuckCosmosDbHealth(JSON.stringify(stuckHealth)), true)
  assert.equal(
    isStuckCosmosDbHealth(
      JSON.stringify({
        ...stuckHealth,
        checks: { ...stuckHealth.checks, gateway: 'unhealthy' },
      }),
    ),
    false,
  )
  assert.equal(isStuckCosmosDbHealth('not json'), false)
})

test('recreates a stuck Cosmos fixture once and resumes readiness polling', async () => {
  const responses = [
    response(503, stuckHealth),
    response(200, stuckHealth),
    response(200, { ...stuckHealth, checks: { postgres: 'healthy' }, ready: true }),
  ]
  let recreations = 0

  await waitForCosmosDbReady({
    healthPort: 18082,
    attempts: 1,
    fetchImpl: async () => responses.shift(),
    recreate: async () => {
      recreations += 1
    },
    onRecovery: () => undefined,
  })

  assert.equal(recreations, 1)
  assert.equal(responses.length, 0)
})

test('does not repeatedly recreate an emulator that remains unhealthy', async () => {
  let recreations = 0

  await assert.rejects(
    waitForCosmosDbReady({
      healthPort: 18082,
      attempts: 1,
      fetchImpl: async () => response(503, stuckHealth),
      recreate: async () => {
        recreations += 1
      },
      onRecovery: () => undefined,
    }),
    /Automatic one-container recovery did not restore readiness/,
  )

  assert.equal(recreations, 1)
})

test('leaves unrelated readiness failures untouched', async () => {
  let recreations = 0

  await assert.rejects(
    waitForCosmosDbReady({
      healthPort: 18082,
      attempts: 1,
      fetchImpl: async () => response(503, { alive: true, ready: false }),
      recreate: async () => {
        recreations += 1
      },
    }),
    /did not match the safe automatic-recovery signature/,
  )

  assert.equal(recreations, 0)
})

test('waits for Cosmos fixture initialization after HTTP readiness', async () => {
  const results = [
    { ready: false, detail: "Database 'datapadplusplus' not found." },
    { ready: true, detail: '3' },
  ]
  let waits = 0

  await waitForCosmosDbInitialization({
    attempts: 2,
    check: async () => results.shift(),
    wait: async () => {
      waits += 1
    },
  })

  assert.equal(waits, 1)
  assert.equal(results.length, 0)
})

test('reports a bounded initialization timeout without recreating again', async () => {
  await assert.rejects(
    waitForCosmosDbInitialization({
      attempts: 2,
      check: async () => ({
        ready: false,
        detail: "Database 'datapadplusplus' not found.",
      }),
      wait: async () => undefined,
    }),
    /init script did not make the fixture database queryable/,
  )
})
