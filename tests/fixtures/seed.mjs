import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const generatedEnvPath = join(root, '.generated.env')
const requestedProfiles = new Set(
  [
    process.argv[2],
    process.env.DATAPADPLUSPLUS_FIXTURE_PROFILE,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean),
)

function loadGeneratedEnvironment() {
  if (!existsSync(generatedEnvPath)) {
    return
  }

  for (const line of readFileSync(generatedEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex)
    const value = trimmed.slice(separatorIndex + 1)

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function fixturePort(envName, fallback) {
  return Number.parseInt(process.env[envName] ?? String(fallback), 10)
}

loadGeneratedEnvironment()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return result.stdout ?? ''
}

function docker(args, options = {}) {
  return run('docker', args, options)
}

function containerRunning(name) {
  const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
  })

  return result.status === 0 && result.stdout.trim() === 'true'
}

function shouldSeed(container, profile = 'core') {
  if (!containerRunning(container)) {
    return false
  }

  return (
    profile === 'core' ||
    requestedProfiles.size === 0 ||
    requestedProfiles.has('all') ||
    requestedProfiles.has(profile)
  )
}

function seedSqlWithStdin(container, command, args, scriptPath) {
  if (!containerRunning(container)) {
    return
  }

  docker(['exec', '-i', container, command, ...args], {
    input: readFileSync(scriptPath, 'utf8'),
  })
}

function fixtureInitScripts(folder, extensions = ['.sql']) {
  const initDirectory = join(root, folder, 'init')

  if (!existsSync(initDirectory)) {
    return []
  }

  return readdirSync(initDirectory)
    .filter((entry) => extensions.some((extension) => entry.endsWith(extension)))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(initDirectory, entry))
}

function seedSqlFolderWithStdin(container, command, args, folder, extensions = ['.sql']) {
  for (const scriptPath of fixtureInitScripts(folder, extensions)) {
    seedSqlWithStdin(container, command, args, scriptPath)
  }
}

function redisProtocolCommand(parts) {
  return `*${parts.length}\r\n${parts
    .map((part) => {
      const value = String(part)
      return `$${Buffer.byteLength(value)}\r\n${value}\r\n`
    })
    .join('')}`
}

function seedRedisPerfKeys(container, command = 'redis-cli') {
  if (!containerRunning(container)) {
    return
  }

  const keyCount = Number.parseInt(process.env.DATAPADPLUSPLUS_REDIS_PERF_KEYS ?? '100000', 10)
  const commands = []

  commands.push(redisProtocolCommand(['DEL', 'perf:manifest']))
  commands.push(
    redisProtocolCommand([
      'HSET',
      'perf:manifest',
      'keyCount',
      String(keyCount),
      'description',
      'Synthetic keys for DataPad++ result and explorer performance tests.',
    ]),
  )

  for (let index = 1; index <= keyCount; index += 1) {
    const key = `perf:session:${String(index).padStart(6, '0')}`
    commands.push(
      redisProtocolCommand([
        'HSET',
        key,
        'userId',
        `user-${index % 10000}`,
        'region',
        ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local'][index % 5],
        'active',
        index % 3 === 0 ? '0' : '1',
        'score',
        String(index % 1000),
      ]),
    )

    if (index % 5 === 0) {
      commands.push(redisProtocolCommand(['EXPIRE', key, String(1800 + (index % 7200))]))
    }
  }

  docker(['exec', '-i', container, command, '--pipe'], {
    input: commands.join(''),
  })
}

function seedKeyValueDomain(container, command = 'redis-cli') {
  if (!containerRunning(container)) {
    return
  }

  const commands = [
    redisProtocolCommand([
      'DEL',
      'account:1',
      'account:2',
      'product:luna-lamp',
      'product:aurora-desk',
      'orders:recent',
      'account:1:segments',
      'products:inventory',
      'stream:orders',
    ]),
    redisProtocolCommand([
      'SET',
      'account:1',
      JSON.stringify({ id: 1, name: 'Northwind', status: 'active', tier: 'enterprise' }),
    ]),
    redisProtocolCommand([
      'SET',
      'account:2',
      JSON.stringify({ id: 2, name: 'Contoso', status: 'active', tier: 'growth' }),
    ]),
    redisProtocolCommand([
      'HSET',
      'product:luna-lamp',
      'sku',
      'luna-lamp',
      'name',
      'Luna Lamp',
      'category',
      'lighting',
      'inventory_available',
      '18',
      'price',
      '49.99',
    ]),
    redisProtocolCommand([
      'HSET',
      'product:aurora-desk',
      'sku',
      'aurora-desk',
      'name',
      'Aurora Desk',
      'category',
      'furniture',
      'inventory_available',
      '8',
      'price',
      '349.00',
    ]),
    redisProtocolCommand(['RPUSH', 'orders:recent', '101', '102', '103']),
    redisProtocolCommand(['SADD', 'account:1:segments', 'enterprise', 'beta', 'priority-support']),
    redisProtocolCommand(['ZADD', 'products:inventory', '18', 'luna-lamp', '8', 'aurora-desk', '24', 'nova-chair']),
    redisProtocolCommand([
      'XADD',
      'stream:orders',
      '1767225600000-0',
      'order_id',
      '101',
      'account_id',
      '1',
      'status',
      'processing',
    ]),
    redisProtocolCommand([
      'XADD',
      'stream:orders',
      '1767225660000-0',
      'order_id',
      '102',
      'account_id',
      '2',
      'status',
      'fulfilled',
    ]),
    redisProtocolCommand(['XGROUP', 'CREATE', 'stream:orders', 'fulfillment', '0', 'MKSTREAM']),
    redisProtocolCommand([
      'XREADGROUP',
      'GROUP',
      'fulfillment',
      'worker-1',
      'COUNT',
      '1',
      'STREAMS',
      'stream:orders',
      '>',
    ]),
  ]

  docker(['exec', '-i', container, command, '--pipe'], {
    input: commands.join(''),
  })
}

function redisCommandIfSupported(container, parts, command = 'redis-cli') {
  if (!containerRunning(container)) {
    return false
  }

  const result = spawnSync('docker', ['exec', container, command, ...parts.map(String)], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'ignore',
    shell: false,
  })

  return result.status === 0
}

function seedRedisStackDomain(container) {
  if (!containerRunning(container)) {
    return
  }

  seedKeyValueDomain(container)
  redisCommandIfSupported(container, ['DEL', 'json:account:1', 'ts:orders:throughput'])
  redisCommandIfSupported(container, [
    'JSON.SET',
    'json:account:1',
    '$',
    JSON.stringify({
      id: 1,
      name: 'Northwind',
      tier: 'enterprise',
      preferences: { currency: 'USD', dashboard: true },
    }),
  ])
  redisCommandIfSupported(container, ['TS.CREATE', 'ts:orders:throughput', 'RETENTION', '86400000'])
  redisCommandIfSupported(container, ['TS.ADD', 'ts:orders:throughput', '1767225600000', '12'])
  redisCommandIfSupported(container, ['TS.ADD', 'ts:orders:throughput', '1767225660000', '18'])
  redisCommandIfSupported(container, ['BF.RESERVE', 'bf:seen-orders', '0.01', '1000'])
  redisCommandIfSupported(container, ['BF.ADD', 'bf:seen-orders', 'order-101'])
  redisCommandIfSupported(container, ['CF.RESERVE', 'cf:skus', '1000'])
  redisCommandIfSupported(container, ['CF.ADD', 'cf:skus', 'luna-lamp'])
  redisCommandIfSupported(container, ['CMS.INITBYDIM', 'cms:regions', '20', '5'])
  redisCommandIfSupported(container, ['CMS.INCRBY', 'cms:regions', 'eu-west-1', '3'])
  redisCommandIfSupported(container, ['TOPK.RESERVE', 'topk:products', '5'])
  redisCommandIfSupported(container, ['TOPK.ADD', 'topk:products', 'luna-lamp', 'aurora-desk'])
  redisCommandIfSupported(container, ['TDIGEST.CREATE', 'tdigest:latency'])
  redisCommandIfSupported(container, ['TDIGEST.ADD', 'tdigest:latency', '12', '18', '23'])
  redisCommandIfSupported(container, ['DEL', 'vectors:products'])
  redisCommandIfSupported(container, [
    'VADD',
    'vectors:products',
    'VALUES',
    '3',
    '0.12',
    '0.24',
    '0.56',
    'luna-lamp',
    'SETATTR',
    JSON.stringify({ sku: 'luna-lamp', category: 'lighting' }),
  ])
  redisCommandIfSupported(container, [
    'VADD',
    'vectors:products',
    'VALUES',
    '3',
    '0.75',
    '0.11',
    '0.20',
    'aurora-desk',
    'SETATTR',
    JSON.stringify({ sku: 'aurora-desk', category: 'furniture' }),
  ])
}

function runPython(script) {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python']

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      stdio: 'ignore',
      shell: false,
    })

    if (probe.status === 0) {
      run(candidate, [script])
      return
    }
  }

  throw new Error('Python 3 is required to create the SQLite fixture database.')
}

function httpRequest({ method = 'GET', port, path, body, headers = {} }) {
  const payload = body ? JSON.stringify(body) : undefined

  return new Promise((resolve, reject) => {
    const request = globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: payload,
    })

    request
      .then(async (response) => {
        const text = await response.text()
        if (!response.ok) {
          reject(new Error(`${method} ${port}${path} failed: ${response.status} ${text}`))
          return
        }
        resolve(text)
      })
      .catch(reject)
  })
}

function httpRawRequest({ method = 'POST', port, path, body = '', headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body,
    })

    request
      .then(async (response) => {
        const text = await response.text()
        if (!response.ok) {
          reject(new Error(`${method} ${port}${path} failed: ${response.status} ${text}`))
          return
        }
        resolve(text)
      })
      .catch(reject)
  })
}

function dynamodbLocalAuthHeaders(port) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  return {
    authorization: [
      'AWS4-HMAC-SHA256',
      `Credential=local/${dateStamp}/us-east-1/dynamodb/aws4_request,`,
      'SignedHeaders=content-type;host;x-amz-date;x-amz-target,',
      'Signature=0000000000000000000000000000000000000000000000000000000000000000',
    ].join(' '),
    host: `127.0.0.1:${port}`,
    'x-amz-date': amzDate,
  }
}

function tcpRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload)
    })
    const chunks = []
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('error', reject)
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.setTimeout(5000, () => {
      socket.destroy(new Error(`Timed out waiting for TCP fixture on port ${port}`))
    })
  })
}

async function seedCore() {
  seedSqlFolderWithStdin(
    'datapadplusplus-postgres',
    'psql',
    ['-U', 'datapadplusplus', '-d', 'datapadplusplus'],
    'postgres',
  )

  seedSqlFolderWithStdin(
    'datapadplusplus-mysql',
    'mysql',
    ['-udatapadplusplus', '-pdatapadplusplus', 'commerce'],
    'mysql',
  )

  if (containerRunning('datapadplusplus-sqlserver')) {
    for (const scriptPath of fixtureInitScripts('sqlserver')) {
      docker([
        'exec',
        'datapadplusplus-sqlserver',
        '/opt/mssql-tools18/bin/sqlcmd',
        '-S',
        'localhost',
        '-U',
        'sa',
        '-P',
        'DataPadPlusPlus_pwd_123',
        '-C',
        '-i',
        `/work/${scriptPath.split(/[\\/]/).at(-1)}`,
      ])
    }
  }

  if (containerRunning('datapadplusplus-mongodb')) {
    docker([
      'exec',
      'datapadplusplus-mongodb',
      'mongosh',
      '--quiet',
      '--username',
      'datapadplusplus',
      '--password',
      'datapadplusplus',
      '--authenticationDatabase',
      'admin',
      '/docker-entrypoint-initdb.d/001_seed.js',
    ])
  }

  if (containerRunning('datapadplusplus-redis')) {
    seedKeyValueDomain('datapadplusplus-redis')
    docker([
      'exec',
      'datapadplusplus-redis',
      'redis-cli',
      'HSET',
      'session:9f2d7e1a',
      'userId',
      'a1b2c3',
      'region',
      'eu-west-1',
      'active',
      '1',
    ])
    docker(['exec', 'datapadplusplus-redis', 'redis-cli', 'EXPIRE', 'session:9f2d7e1a', '1800'])
    docker([
      'exec',
      'datapadplusplus-redis',
      'redis-cli',
      'SET',
      'cache:feature-flags',
      '{"beta":true,"region":"local"}',
    ])
    seedRedisPerfKeys('datapadplusplus-redis')
  }

  runPython(join(root, 'sqlite', 'seed.py'))
}

async function seedCache() {
  if (shouldSeed('datapadplusplus-redis-stack', 'redis-stack')) {
    seedRedisStackDomain('datapadplusplus-redis-stack')
  }

  if (shouldSeed('datapadplusplus-valkey', 'cache')) {
    seedKeyValueDomain('datapadplusplus-valkey', 'valkey-cli')
    docker([
      'exec',
      'datapadplusplus-valkey',
      'valkey-cli',
      'HSET',
      'session:9f2d7e1a',
      'userId',
      'a1b2c3',
      'region',
      'eu-west-1',
      'active',
      '1',
    ])
    docker(['exec', 'datapadplusplus-valkey', 'valkey-cli', 'EXPIRE', 'session:9f2d7e1a', '1800'])
    seedRedisPerfKeys('datapadplusplus-valkey', 'valkey-cli')
  }

  if (shouldSeed('datapadplusplus-memcached', 'cache')) {
    const generatedSets = []
    for (let id = 1; id <= 500; id += 1) {
      const key = `product:fixture:${String(id).padStart(4, '0')}`
      const value = JSON.stringify({
        sku: `sku-${String(id).padStart(4, '0')}`,
        name: `Fixture Product ${id}`,
        category: ['lighting', 'furniture', 'storage', 'audio', 'office'][id % 5],
        inventory_available: (id * 17) % 250,
        price: Number(((id % 500) / 2.5 + 12).toFixed(2)),
      })
      generatedSets.push(`set ${key} 0 3600 ${Buffer.byteLength(value)}`, value)
    }

    await tcpRequest(
      fixturePort('DATAPADPLUSPLUS_MEMCACHED_PORT', 11212),
      [
        'set cache:feature-flags 0 3600 30',
        '{"beta":true,"region":"local"}',
        'set account:1 0 3600 65',
        '{"id":1,"name":"Northwind","status":"active","tier":"enterprise"}',
        'set product:luna-lamp 0 3600 77',
        '{"sku":"luna-lamp","name":"Luna Lamp","inventory_available":18,"price":49.99}',
        ...generatedSets,
        'quit',
        '',
      ].join('\r\n'),
    )
  }
}

async function seedSqlPlus() {
  if (shouldSeed('datapadplusplus-mariadb', 'sqlplus')) {
    seedSqlFolderWithStdin(
      'datapadplusplus-mariadb',
      'mariadb',
      ['-udatapadplusplus', '-pdatapadplusplus', 'commerce'],
      'mariadb',
    )
  }

  if (shouldSeed('datapadplusplus-cockroachdb', 'sqlplus')) {
    for (const scriptPath of fixtureInitScripts('cockroach')) {
      docker([
        'exec',
        'datapadplusplus-cockroachdb',
        '/cockroach/cockroach',
        'sql',
        '--insecure',
        `--file=/docker-entrypoint-initdb.d/${scriptPath.split(/[\\/]/).at(-1)}`,
      ])
    }
  }

  if (shouldSeed('datapadplusplus-timescaledb', 'sqlplus')) {
    seedSqlFolderWithStdin(
      'datapadplusplus-timescaledb',
      'psql',
      ['-U', 'datapadplusplus', '-d', 'metrics'],
      'timescaledb',
    )
  }
}

async function seedAnalytics() {
  if (shouldSeed('datapadplusplus-clickhouse', 'analytics')) {
    seedSqlFolderWithStdin(
      'datapadplusplus-clickhouse',
      'clickhouse-client',
      ['--user', 'datapadplusplus', '--password', 'datapadplusplus', '--multiquery'],
      'clickhouse',
    )
  }

  if (shouldSeed('datapadplusplus-influxdb', 'analytics')) {
    const influxPort = fixturePort('DATAPADPLUSPLUS_INFLUXDB_PORT', 8087)
    await httpRequest({ port: influxPort, path: '/query?q=CREATE+DATABASE+metrics' })
    for (const query of [
      'INSERT order_latency,region=eu-west-1,account_id=1 value=18.4 1767225600000000000',
      'INSERT order_latency,region=eu-west-1,account_id=1 value=21.0 1767225660000000000',
      'INSERT order_latency,region=us-east-1,account_id=2 value=32.7 1767225720000000000',
    ]) {
      await httpRequest({
        port: influxPort,
        path: `/query?db=metrics&q=${encodeURIComponent(query)}`,
      })
    }

    const pointCount = Number.parseInt(process.env.DATAPADPLUSPLUS_INFLUX_POINTS ?? '50000', 10)
    const batch = []
    const baseTimestamp = 1767225600000000000n
    for (let id = 1; id <= pointCount; id += 1) {
      const region = ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local'][id % 5]
      const service = ['api', 'worker', 'search', 'billing', 'scheduler'][id % 5]
      const timestamp = baseTimestamp + BigInt(id) * 60_000_000_000n
      batch.push(
        `service_health,region=${region},service=${service},host=fixture-${id % 20} cpu_pct=${((id % 900) / 10 + 5).toFixed(2)},memory_mb=${((id % 8000) / 3 + 256).toFixed(2)},requests=${(id % 5000) + 50}i ${timestamp}`,
      )

      if (batch.length >= 5000) {
        await httpRawRequest({
          port: influxPort,
          path: '/write?db=metrics',
          body: batch.join('\n'),
          headers: { 'content-type': 'text/plain' },
        })
        batch.length = 0
      }
    }

    if (batch.length > 0) {
      await httpRawRequest({
        port: influxPort,
        path: '/write?db=metrics',
        body: batch.join('\n'),
        headers: { 'content-type': 'text/plain' },
      })
    }
  }
}

async function bulkIndexSearchDocuments(port, index, documents, batchSize = 1000) {
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const lines = []
    for (const document of documents.slice(offset, offset + batchSize)) {
      lines.push(JSON.stringify({ index: { _index: index, _id: document.id } }))
      lines.push(JSON.stringify(document.body))
    }
    await httpRawRequest({
      method: 'POST',
      port,
      path: '/_bulk?refresh=true',
      body: `${lines.join('\n')}\n`,
      headers: { 'content-type': 'application/x-ndjson' },
    })
  }
}

async function seedSearch() {
  for (const [container, port] of [
    ['datapadplusplus-opensearch', fixturePort('DATAPADPLUSPLUS_OPENSEARCH_PORT', 9201)],
    ['datapadplusplus-elasticsearch', fixturePort('DATAPADPLUSPLUS_ELASTICSEARCH_PORT', 9202)],
  ]) {
    if (!shouldSeed(container, 'search')) {
      continue
    }
    await httpRequest({
      method: 'PUT',
      port,
      path: '/orders',
      body: {
        mappings: {
          properties: {
            order_id: { type: 'keyword' },
            status: { type: 'keyword' },
            total_amount: { type: 'double' },
            updated_at: { type: 'date' },
          },
        },
      },
    }).catch(() => undefined)
    await httpRequest({
      method: 'PUT',
      port,
      path: '/products',
      body: {
        mappings: {
          properties: {
            sku: { type: 'keyword' },
            name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            category: { type: 'keyword' },
            inventory_available: { type: 'integer' },
            price: { type: 'double' },
            updated_at: { type: 'date' },
          },
        },
      },
    }).catch(() => undefined)
    await httpRequest({
      method: 'POST',
      port,
      path: '/products/_doc/luna-lamp?refresh=true',
      body: {
        sku: 'luna-lamp',
        name: 'Luna Lamp',
        category: 'lighting',
        inventory_available: 18,
        price: 49.99,
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
    await httpRequest({
      method: 'POST',
      port,
      path: '/products/_doc/aurora-desk?refresh=true',
      body: {
        sku: 'aurora-desk',
        name: 'Aurora Desk',
        category: 'furniture',
        inventory_available: 8,
        price: 349,
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
    await httpRequest({
      method: 'POST',
      port,
      path: '/orders/_doc/101?refresh=true',
      body: {
        order_id: '101',
        account: { id: '1', name: 'Northwind' },
        status: 'processing',
        total_amount: 128.4,
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
    await httpRequest({
      method: 'POST',
      port,
      path: '/orders/_doc/102?refresh=true',
      body: {
        order_id: '102',
        account: { id: '2', name: 'Contoso' },
        status: 'fulfilled',
        total_amount: 88,
        updated_at: '2026-01-01T00:02:00Z',
      },
    })

    const generatedProducts = []
    for (let id = 1; id <= 5000; id += 1) {
      generatedProducts.push({
        id: `sku-${String(id).padStart(4, '0')}`,
        body: {
          sku: `sku-${String(id).padStart(4, '0')}`,
          name: `Fixture Product ${id}`,
          category: ['lighting', 'furniture', 'storage', 'audio', 'office', 'accessories'][id % 6],
          inventory_available: (id * 17) % 250,
          price: Number(((id % 500) / 2.5 + 12).toFixed(2)),
          tags: [`sku-${id % 100}`, id % 2 === 0 ? 'even' : 'odd'],
          updated_at: new Date(Date.now() - (id % 720) * 60 * 1000).toISOString(),
        },
      })
    }
    await bulkIndexSearchDocuments(port, 'products', generatedProducts)

    const generatedOrders = []
    for (let id = 1; id <= 10000; id += 1) {
      generatedOrders.push({
        id: String(1000 + id),
        body: {
          order_id: String(1000 + id),
          account: {
            id: String((id % 500) + 1),
            name: `Fixture Account ${(id % 500) + 1}`,
            tier: ['enterprise', 'growth', 'starter', 'scale'][id % 4],
          },
          status: ['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold'][id % 7],
          total_amount: Number(((id % 20000) / 4 + 25).toFixed(2)),
          item_count: (id % 3) + 1,
          region: ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local'][id % 5],
          updated_at: new Date(Date.now() - (id % 259200) * 1000).toISOString(),
        },
      })
    }
    await bulkIndexSearchDocuments(port, 'orders', generatedOrders)
  }
}

async function seedGraph() {
  if (shouldSeed('datapadplusplus-neo4j', 'graph')) {
    await httpRequest({
      method: 'POST',
      port: fixturePort('DATAPADPLUSPLUS_NEO4J_HTTP_PORT', 7475),
      path: '/db/neo4j/tx/commit',
      headers: {
        authorization: `Basic ${Buffer.from('neo4j:datapadplusplus').toString('base64')}`,
      },
      body: {
        statements: [
          {
            statement:
              "MERGE (a:Account {id:'1', name:'Northwind'}) MERGE (o:Order {id:'101', status:'processing'}) MERGE (a)-[:PLACED]->(o) RETURN a, o",
          },
          {
            statement:
              "UNWIND range(1, 500) AS id MERGE (a:Account {id: toString(id)}) SET a.name = 'Fixture Account ' + toString(id), a.status = CASE WHEN id % 6 = 0 THEN 'paused' ELSE 'active' END WITH id, a UNWIND range(1, 5) AS orderOffset MERGE (o:Order {id: toString((id * 1000) + orderOffset)}) SET o.status = CASE WHEN orderOffset % 3 = 0 THEN 'fulfilled' ELSE 'processing' END, o.totalAmount = id * orderOffset + 25 MERGE (a)-[:PLACED]->(o)",
          },
        ],
      },
    })
  }

  if (shouldSeed('datapadplusplus-arangodb', 'graph')) {
    const auth = { authorization: `Basic ${Buffer.from('root:datapadplusplus').toString('base64')}` }
    const arangoPort = fixturePort('DATAPADPLUSPLUS_ARANGODB_PORT', 8529)
    await httpRequest({ method: 'POST', port: arangoPort, path: '/_api/database', headers: auth, body: { name: 'datapadplusplus' } }).catch(() => undefined)
    await httpRequest({ method: 'POST', port: arangoPort, path: '/_db/datapadplusplus/_api/collection', headers: auth, body: { name: 'accounts' } }).catch(() => undefined)
    await httpRequest({ method: 'POST', port: arangoPort, path: '/_db/datapadplusplus/_api/collection', headers: auth, body: { name: 'orders' } }).catch(() => undefined)
    await httpRequest({
      method: 'POST',
      port: arangoPort,
      path: '/_db/datapadplusplus/_api/cursor',
      headers: auth,
      body: {
        query:
          "UPSERT { _key: '1' } INSERT { _key: '1', name: 'Northwind', status: 'active' } UPDATE { status: 'active' } IN accounts",
      },
    })
    await httpRequest({
      method: 'POST',
      port: arangoPort,
      path: '/_db/datapadplusplus/_api/cursor',
      headers: auth,
      body: {
        query:
          "FOR id IN 1..500 UPSERT { _key: TO_STRING(id) } INSERT { _key: TO_STRING(id), name: CONCAT('Fixture Account ', id), status: id % 6 == 0 ? 'paused' : 'active', tier: ['enterprise','growth','starter','scale'][id % 4] } UPDATE { status: OLD.status } IN accounts",
      },
    })
    await httpRequest({
      method: 'POST',
      port: arangoPort,
      path: '/_db/datapadplusplus/_api/cursor',
      headers: auth,
      body: {
        query:
          "FOR id IN 1..5000 UPSERT { _key: TO_STRING(1000 + id) } INSERT { _key: TO_STRING(1000 + id), accountId: TO_STRING((id % 500) + 1), status: ['created','processing','paid','fulfilled','returned','cancelled','on-hold'][id % 7], totalAmount: (id % 20000) / 4 + 25, updatedAt: DATE_ISO8601(DATE_NOW() - (id % 259200) * 1000) } UPDATE { status: OLD.status } IN orders",
      },
    })
  }
}

async function seedWideColumn() {
  if (shouldSeed('datapadplusplus-cassandra', 'widecolumn')) {
    for (const scriptPath of fixtureInitScripts('cassandra', ['.cql'])) {
      docker([
        'exec',
        'datapadplusplus-cassandra',
        'cqlsh',
        '-f',
        `/work/${scriptPath.split(/[\\/]/).at(-1)}`,
      ])
    }
    const statements = ['use datapadplusplus;']
    for (let id = 4; id <= 500; id += 1) {
      statements.push(
        `insert into accounts_by_id (account_id, name, status, tier, updated_at) values (${id}, 'Fixture Account ${id}', '${id % 6 === 0 ? 'paused' : 'active'}', '${['enterprise', 'growth', 'starter', 'scale'][id % 4]}', toTimestamp(now()));`,
      )
    }
    for (let id = 1; id <= 1000; id += 1) {
      statements.push(
        `insert into products_by_sku (sku, name, category, inventory_available, price, updated_at) values ('sku-${String(id).padStart(4, '0')}', 'Fixture Product ${id}', '${['lighting', 'furniture', 'storage', 'audio', 'office', 'accessories'][id % 6]}', ${(id * 17) % 250}, ${((id % 500) / 2.5 + 12).toFixed(2)}, toTimestamp(now()));`,
      )
    }
    for (let id = 1; id <= 10000; id += 1) {
      statements.push(
        `insert into orders_by_account (account_id, order_id, status, total_amount, updated_at) values (${(id % 500) + 1}, ${1000 + id}, '${['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold'][id % 7]}', ${((id % 20000) / 4 + 25).toFixed(2)}, toTimestamp(now()));`,
      )
    }
    docker(['exec', '-i', 'datapadplusplus-cassandra', 'cqlsh'], {
      input: `${statements.join('\n')}\n`,
    })
  }
}

async function seedOracle() {
  if (shouldSeed('datapadplusplus-oracle', 'oracle')) {
    for (const scriptPath of fixtureInitScripts('oracle')) {
      docker([
        'exec',
        'datapadplusplus-oracle',
        'bash',
        '-lc',
        `sqlplus -s datapadplusplus/datapadplusplus@//localhost:1521/FREEPDB1 @/container-entrypoint-initdb.d/${scriptPath.split(/[\\/]/).at(-1)}`,
      ])
    }
  }
}

async function seedCosmosDbEmulator() {
  if (!shouldSeed('datapadplusplus-cosmosdb', 'cosmosdb')) {
    return
  }

  docker([
    'exec',
    'datapadplusplus-cosmosdb',
    'cosmoshell.sh',
    '-c',
    'query "SELECT VALUE COUNT(1) FROM c" --database=datapadplusplus --container=orders',
  ])
}

async function seedCloudContract() {
  if (!shouldSeed('datapadplusplus-dynamodb', 'cloud-contract')) {
    return
  }

  const dynamodbPort = fixturePort('DATAPADPLUSPLUS_DYNAMODB_PORT', 8001)
  const endpoint = `http://127.0.0.1:${dynamodbPort}`

  async function dynamodb(target, body) {
    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        ...dynamodbLocalAuthHeaders(dynamodbPort),
        'x-amz-target': `DynamoDB_20120810.${target}`,
        'content-type': 'application/x-amz-json-1.0',
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`${target} failed: ${response.status} ${text}`)
    }

    return text ? JSON.parse(text) : {}
  }

  const tables = [
    { name: 'accounts', key: 'account_id' },
    { name: 'products', key: 'sku' },
    { name: 'orders', key: 'order_id' },
    { name: 'order_events', key: 'pk', rangeKey: 'sk' },
  ]

  for (const table of tables) {
    await dynamodb('CreateTable', {
      TableName: table.name,
      AttributeDefinitions: [
        { AttributeName: table.key, AttributeType: 'S' },
        ...(table.rangeKey ? [{ AttributeName: table.rangeKey, AttributeType: 'S' }] : []),
      ],
      KeySchema: [
        { AttributeName: table.key, KeyType: 'HASH' },
        ...(table.rangeKey ? [{ AttributeName: table.rangeKey, KeyType: 'RANGE' }] : []),
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }).catch((error) => {
      if (!String(error.message).includes('ResourceInUseException')) {
        throw error
      }
    })
  }

  async function waitForTable(tableName) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await dynamodb('DescribeTable', { TableName: tableName }).catch(() => undefined)
      if (result?.Table?.TableStatus === 'ACTIVE') {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`DynamoDB fixture table ${tableName} did not become active`)
  }

  for (const table of tables) {
    await waitForTable(table.name)
  }

  await dynamodb('PutItem', {
    TableName: 'accounts',
    Item: {
      account_id: { S: '1' },
      name: { S: 'Northwind' },
      status: { S: 'active' },
      tier: { S: 'enterprise' },
    },
  })
  await dynamodb('PutItem', {
    TableName: 'products',
    Item: {
      sku: { S: 'luna-lamp' },
      name: { S: 'Luna Lamp' },
      category: { S: 'lighting' },
      inventory_available: { N: '18' },
      price: { N: '49.99' },
    },
  })
  await dynamodb('PutItem', {
    TableName: 'orders',
    Item: {
      order_id: { S: '101' },
      account_id: { S: '1' },
      status: { S: 'processing' },
      total_amount: { N: '128.40' },
    },
  })

  async function batchWrite(tableName, items) {
    for (let offset = 0; offset < items.length; offset += 25) {
      const result = await dynamodb('BatchWriteItem', {
        RequestItems: {
          [tableName]: items.slice(offset, offset + 25).map((Item) => ({
            PutRequest: { Item },
          })),
        },
      })
      const unprocessed = result.UnprocessedItems?.[tableName]?.length ?? 0
      if (unprocessed > 0) {
        throw new Error(`BatchWriteItem left ${unprocessed} unprocessed item(s) for ${tableName}`)
      }
    }
  }

  await batchWrite(
    'accounts',
    Array.from({ length: 500 }, (_, index) => {
      const id = index + 1
      return {
        account_id: { S: String(id) },
        name: { S: id <= 3 ? ['Northwind', 'Contoso', 'Fabrikam'][id - 1] : `Fixture Account ${id}` },
        status: { S: id % 6 === 0 ? 'paused' : 'active' },
        tier: { S: ['enterprise', 'growth', 'starter', 'scale'][id % 4] },
      }
    }),
  )
  await batchWrite(
    'products',
    Array.from({ length: 1000 }, (_, index) => {
      const id = index + 1
      return {
        sku: { S: `sku-${String(id).padStart(4, '0')}` },
        name: { S: `Fixture Product ${id}` },
        category: { S: ['lighting', 'furniture', 'storage', 'audio', 'office', 'accessories'][id % 6] },
        inventory_available: { N: String((id * 17) % 250) },
        price: { N: ((id % 500) / 2.5 + 12).toFixed(2) },
      }
    }),
  )
  await batchWrite(
    'orders',
    Array.from({ length: 5000 }, (_, index) => {
      const id = index + 1
      return {
        order_id: { S: String(1000 + id) },
        account_id: { S: String((id % 500) + 1) },
        status: { S: ['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold'][id % 7] },
        total_amount: { N: ((id % 20000) / 4 + 25).toFixed(2) },
      }
    }),
  )
  await batchWrite(
    'order_events',
    Array.from({ length: 10000 }, (_, index) => {
      const id = index + 1
      return {
        pk: { S: `ACCOUNT#${String((id % 500) + 1)}` },
        sk: { S: `ORDER#${String(1000 + id)}#EVENT#${String(id).padStart(6, '0')}` },
        order_id: { S: String(1000 + id) },
        status: { S: ['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold'][id % 7] },
        amount: { N: ((id % 20000) / 4 + 25).toFixed(2) },
      }
    }),
  )
}

await seedCore()
await seedCache()
await seedSqlPlus()
await seedAnalytics()
await seedSearch()
await seedGraph()
await seedWideColumn()
await seedOracle()
await seedCosmosDbEmulator()
await seedCloudContract()
