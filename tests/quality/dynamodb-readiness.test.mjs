import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForDynamoDbReady } from '../fixtures/dynamodb-readiness.mjs'

test('DynamoDB fixture startup retries only a read probe before allowing seeding', async () => {
  let calls = 0
  let waits = 0
  await waitForDynamoDbReady({ request: async (operation, body) => {
    assert.equal(operation, 'ListTables')
    assert.deepEqual(body, { Limit: 1 })
    if (++calls < 3) throw new Error('not listening yet')
  }, wait: async () => { waits++ } })
  assert.equal(calls, 3)
  assert.equal(waits, 2)
})

test('DynamoDB startup failure is bounded and does not disclose response contents', async () => {
  let calls = 0
  await assert.rejects(waitForDynamoDbReady({ request: async () => {
    calls++
    throw new Error('private server response')
  }, attempts: 2, wait: async () => {} }), error => {
    assert.match(error.message, /did not become ready/)
    assert.doesNotMatch(error.message, /private/)
    return true
  })
  assert.equal(calls, 2)
})
