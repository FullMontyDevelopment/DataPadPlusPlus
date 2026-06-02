import http from 'node:http'

const regions = ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local']
const statuses = ['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold']
const tiers = ['enterprise', 'growth', 'starter', 'scale']

function json(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function collect(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function bigQueryHandler(req, res) {
  if (req.url === '/health') return json(res, { ok: true, service: 'bigquery' })
  if (req.url.includes('/datasets') && req.method === 'GET') {
    return json(res, {
      datasets: [
        { datasetReference: { datasetId: 'analytics' } },
        { datasetReference: { datasetId: 'commerce' } },
        { datasetReference: { datasetId: 'operations' } },
      ],
    })
  }
  if (req.url.includes('/tables') && req.method === 'GET') {
    return json(res, {
      tables: [
        { tableReference: { tableId: 'accounts' }, numRows: '500' },
        { tableReference: { tableId: 'products' }, numRows: '1000' },
        { tableReference: { tableId: 'orders' }, numRows: '25000' },
        { tableReference: { tableId: 'order_items' }, numRows: '75000' },
        { tableReference: { tableId: 'support_tickets' }, numRows: '5000' },
        { tableReference: { tableId: 'events' }, numRows: '250000' },
      ],
    })
  }
  const rows = Array.from({ length: 100 }, (_, index) => {
    const id = index + 1
    return {
      f: [
        { v: String(1000 + id) },
        { v: statuses[id % statuses.length] },
        { v: regions[id % regions.length] },
        { v: String(((id % 20000) / 4 + 25).toFixed(2)) },
      ],
    }
  })
  return json(res, {
    jobComplete: true,
    totalBytesProcessed: '52428800',
    schema: {
      fields: [
        { name: 'order_id', type: 'STRING' },
        { name: 'status', type: 'STRING' },
        { name: 'region', type: 'STRING' },
        { name: 'total_amount', type: 'NUMERIC' },
      ],
    },
    rows,
  })
}

async function snowflakeHandler(req, res) {
  if (req.url === '/health') return json(res, { ok: true, service: 'snowflake' })
  await collect(req)
  const rows = Array.from({ length: 100 }, (_, index) => {
    const id = index + 1
    return [
      String(1000 + id),
      statuses[id % statuses.length],
      tiers[id % tiers.length],
      ((id % 20000) / 4 + 25).toFixed(2),
    ]
  })
  return json(res, {
    code: '090001',
    message: 'success',
    statementHandle: 'fixture-statement',
    resultSetMetaData: {
      rowType: [
        { name: 'ORDER_ID', type: 'text' },
        { name: 'STATUS', type: 'text' },
        { name: 'TIER', type: 'text' },
        { name: 'TOTAL_AMOUNT', type: 'fixed' },
      ],
    },
    data: rows,
    stats: { bytesScanned: 52428800, partitionsScanned: 12 },
  })
}

async function cosmosHandler(req, res) {
  if (req.url === '/health') return json(res, { ok: true, service: 'cosmosdb' })
  if (req.url.endsWith('/dbs')) {
    return json(res, { Databases: [{ id: 'datapadplusplus' }] })
  }
  if (req.url.includes('/colls') && !req.url.includes('/docs')) {
    return json(res, {
      DocumentCollections: [
        { id: 'accounts', _count: 500 },
        { id: 'products', _count: 1000 },
        { id: 'orders', _count: 25000 },
        { id: 'order_events', _count: 10000 },
      ],
    })
  }
  await collect(req)
  return json(res, {
    Documents: Array.from({ length: 100 }, (_, index) => {
      const id = index + 1
      return {
        id: `order-${1000 + id}`,
        accountId: String((id % 500) + 1),
        status: statuses[id % statuses.length],
        region: regions[id % regions.length],
        total: Number(((id % 20000) / 4 + 25).toFixed(2)),
        items: [
          { sku: `sku-${String((id % 1000) + 1).padStart(4, '0')}`, quantity: (id % 4) + 1 },
          { sku: `sku-${String(((id + 1) % 1000) + 1).padStart(4, '0')}`, quantity: ((id + 1) % 4) + 1 },
        ],
      }
    }),
  })
}

async function neptuneHandler(req, res) {
  if (req.url === '/health') return json(res, { ok: true, service: 'neptune' })
  if (req.url === '/status') {
    return json(res, { status: 'healthy', role: 'writer' })
  }
  await collect(req)
  return json(res, {
    result: {
      data: Array.from({ length: 50 }, (_, index) => ({
        id: `account-${index + 1}`,
        label: 'Account',
        properties: {
          name: `Fixture Account ${index + 1}`,
          tier: tiers[index % tiers.length],
          orderCount: 5,
        },
      })),
    },
    results: {
      bindings: Array.from({ length: 50 }, (_, index) => ({
        node: { type: 'literal', value: `account-${index + 1}` },
        order: { type: 'literal', value: `order-${1000 + index + 1}` },
      })),
    },
  })
}

const handlers = new Map([
  [19050, bigQueryHandler],
  [19060, snowflakeHandler],
  [19070, cosmosHandler],
  [19080, neptuneHandler],
])

for (const [port, handler] of handlers) {
  http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      json(res, { error: String(error?.message ?? error) }, 500)
    })
  }).listen(port, '0.0.0.0', () => {
    console.log(`DataPad++ cloud-contract fixture listening on ${port}`)
  })
}
