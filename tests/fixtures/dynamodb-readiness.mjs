// Probe only a read operation: startup retries must never repeat a write.
export async function waitForDynamoDbReady({ request, attempts = 30, wait = () => new Promise(resolve => setTimeout(resolve, 500)) }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await request('ListTables', { Limit: 1 })
      return
    } catch {
      if (attempt + 1 < attempts) await wait()
    }
  }
  throw new Error('The DynamoDB Local fixture did not become ready. Check its container status before seeding.')
}
