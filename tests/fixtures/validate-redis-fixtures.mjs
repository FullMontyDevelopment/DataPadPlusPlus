import { spawnSync } from 'node:child_process'
import net from 'node:net'

const args = new Set(process.argv.slice(2))
const requireStack = args.has('--require-stack')
const requireValkey = args.has('--require-valkey')
const requireVector = args.has('--require-vector')

const checks = []
const notes = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function redis(container, cli, parts, options = {}) {
  const result = docker(['exec', container, cli, ...parts.map(String)])
  const commandLabel = `${container} ${cli} ${parts.join(' ')}`

  if (result.status !== 0) {
    if (options.allowFailure) {
      return undefined
    }
    throw new Error(`${commandLabel} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }

  return result.stdout.trim()
}

function redisResult(container, cli, parts) {
  return docker(['exec', container, cli, ...parts.map(String)])
}

function commandOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

async function redisDumpRestore(container, sourceKey, targetKey) {
  const dump = await redisTcp(container, ['DUMP', sourceKey])

  if (!Buffer.isBuffer(dump) || dump.length === 0) {
    throw new Error(`${container} DUMP ${sourceKey} did not return a binary snapshot.`)
  }

  await redisTcp(container, ['DEL', targetKey])
  await redisTcp(container, ['RESTORE', targetKey, '0', dump])
}

async function redisTcp(container, parts) {
  const port = mappedContainerPort(container, 6379)
  const payload = respCommand(parts)

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload)
    })
    const chunks = []
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      const buffer = Buffer.concat(chunks)
      try {
        const parsed = parseResp(buffer)
        socket.end()
        resolve(parsed.value)
      } catch (error) {
        if (error instanceof IncompleteRespError) {
          return
        }
        socket.destroy()
        reject(error)
      }
    })
    socket.on('error', reject)
    socket.setTimeout(5000, () => {
      socket.destroy(new Error(`Timed out waiting for ${container} Redis fixture on port ${port}`))
    })
  })
}

function mappedContainerPort(container, containerPort) {
  const result = docker(['port', container, `${containerPort}/tcp`])

  if (result.status !== 0) {
    throw new Error(`Unable to read mapped port for ${container}:${containerPort}.`)
  }

  const match = result.stdout.match(/:(\d+)\s*$/m)
  if (!match) {
    throw new Error(`Unable to parse mapped port for ${container}:${containerPort}: ${result.stdout}`)
  }

  return Number(match[1])
}

function respCommand(parts) {
  const buffers = [Buffer.from(`*${parts.length}\r\n`)]

  for (const part of parts) {
    const value = Buffer.isBuffer(part) ? part : Buffer.from(String(part))
    buffers.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n'))
  }

  return Buffer.concat(buffers)
}

class IncompleteRespError extends Error {}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) {
    throw new IncompleteRespError()
  }

  const prefix = String.fromCharCode(buffer[offset])
  const lineEnd = buffer.indexOf('\r\n', offset)
  if (lineEnd === -1) {
    throw new IncompleteRespError()
  }
  const line = buffer.subarray(offset + 1, lineEnd).toString('utf8')
  const bodyOffset = lineEnd + 2

  switch (prefix) {
    case '+':
      return { value: line, offset: bodyOffset }
    case '-':
      throw new Error(line)
    case ':':
      return { value: Number(line), offset: bodyOffset }
    case '$': {
      const length = Number(line)
      if (length === -1) {
        return { value: null, offset: bodyOffset }
      }
      const end = bodyOffset + length
      if (buffer.length < end + 2) {
        throw new IncompleteRespError()
      }
      return { value: buffer.subarray(bodyOffset, end), offset: end + 2 }
    }
    case '*': {
      const length = Number(line)
      if (length === -1) {
        return { value: null, offset: bodyOffset }
      }
      const values = []
      let nextOffset = bodyOffset
      for (let index = 0; index < length; index += 1) {
        const parsed = parseResp(buffer, nextOffset)
        values.push(parsed.value)
        nextOffset = parsed.offset
      }
      return { value: values, offset: nextOffset }
    }
    default:
      throw new Error(`Unsupported RESP prefix ${JSON.stringify(prefix)}`)
  }
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expectIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} expected to include ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`)
  }
}

function expectOne(value, label) {
  if (value.trim() !== '1') {
    throw new Error(`${label} expected 1, got ${JSON.stringify(value)}`)
  }
}

function expectAtLeast(value, expected, label) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < expected) {
    throw new Error(`${label} expected at least ${expected}, got ${JSON.stringify(value)}`)
  }
}

function commandSupported(container, cli, command) {
  const output = redis(container, cli, ['COMMAND', 'INFO', command], { allowFailure: true })
  return Boolean(output && !/^\(nil\)$/i.test(output.trim()))
}

async function validateCoreRedis(container = 'datapadplusplus-redis', cli = 'redis-cli', label = 'Redis') {
  await record(`${label}: seeded key/value domain`, () => {
    expectIncludes(redis(container, cli, ['GET', 'account:1']), 'Northwind', `${label} account:1`)
    expectIncludes(redis(container, cli, ['HGET', 'product:luna-lamp', 'sku']), 'luna-lamp', `${label} product hash`)
  })

  await record(`${label}: stream consumer group fixture`, () => {
    expectIncludes(redis(container, cli, ['TYPE', 'stream:orders']), 'stream', `${label} stream type`)
    expectIncludes(redis(container, cli, ['XINFO', 'GROUPS', 'stream:orders']), 'fulfillment', `${label} XINFO GROUPS`)
    expectIncludes(redis(container, cli, ['XPENDING', 'stream:orders', 'fulfillment']), 'worker-1', `${label} XPENDING`)
  })
}

async function validateKeyFilePrimitiveEvidence(container, cli, label) {
  await record(`${label}: core key file export/import primitives`, () => {
    expectIncludes(redis(container, cli, ['TYPE', 'account:1']), 'string', `${label} export string type`)
    expectIncludes(redis(container, cli, ['GET', 'account:1']), 'Northwind', `${label} export string read`)
    expectIncludes(redis(container, cli, ['TYPE', 'product:luna-lamp']), 'hash', `${label} export hash type`)
    expectIncludes(redis(container, cli, ['HGETALL', 'product:luna-lamp']), 'luna-lamp', `${label} export hash read`)
    expectIncludes(redis(container, cli, ['TYPE', 'orders:recent']), 'list', `${label} export list type`)
    expectIncludes(redis(container, cli, ['LRANGE', 'orders:recent', '0', '-1']), '101', `${label} export list read`)
    expectIncludes(redis(container, cli, ['TYPE', 'account:1:segments']), 'set', `${label} export set type`)
    expectIncludes(redis(container, cli, ['SMEMBERS', 'account:1:segments']), 'enterprise', `${label} export set read`)
    expectIncludes(redis(container, cli, ['TYPE', 'products:inventory']), 'zset', `${label} export zset type`)
    expectIncludes(redis(container, cli, ['ZRANGE', 'products:inventory', '0', '-1', 'WITHSCORES']), 'luna-lamp', `${label} export zset read`)
    expectIncludes(redis(container, cli, ['XRANGE', 'stream:orders', '-', '+', 'COUNT', '1']), 'order_id', `${label} export stream read`)

    redis(container, cli, [
      'DEL',
      'fixture:key-file:string',
      'fixture:key-file:hash',
      'fixture:key-file:list',
      'fixture:key-file:set',
      'fixture:key-file:zset',
      'fixture:key-file:stream',
    ])
    redis(container, cli, ['SET', 'fixture:key-file:string', 'validated'])
    redis(container, cli, ['EXPIRE', 'fixture:key-file:string', '60'])
    expectIncludes(redis(container, cli, ['GET', 'fixture:key-file:string']), 'validated', `${label} import string write`)
    const ttl = Number(redis(container, cli, ['TTL', 'fixture:key-file:string']))
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new Error(`${label} import TTL expected positive TTL, got ${ttl}`)
    }
    redis(container, cli, ['HSET', 'fixture:key-file:hash', 'sku', 'clone'])
    expectIncludes(redis(container, cli, ['HGET', 'fixture:key-file:hash', 'sku']), 'clone', `${label} import hash write`)
    redis(container, cli, ['RPUSH', 'fixture:key-file:list', '101', '102'])
    expectIncludes(redis(container, cli, ['LRANGE', 'fixture:key-file:list', '0', '-1']), '102', `${label} import list write`)
    redis(container, cli, ['SADD', 'fixture:key-file:set', 'enterprise'])
    expectOne(redis(container, cli, ['SISMEMBER', 'fixture:key-file:set', 'enterprise']), `${label} import set write`)
    redis(container, cli, ['ZADD', 'fixture:key-file:zset', '18', 'luna-lamp'])
    expectIncludes(redis(container, cli, ['ZSCORE', 'fixture:key-file:zset', 'luna-lamp']), '18', `${label} import zset write`)
    redis(container, cli, ['XADD', 'fixture:key-file:stream', '*', 'order_id', '900', 'status', 'validated'])
    expectIncludes(redis(container, cli, ['XRANGE', 'fixture:key-file:stream', '-', '+']), '900', `${label} import stream write`)
    redis(container, cli, [
      'DEL',
      'fixture:key-file:string',
      'fixture:key-file:hash',
      'fixture:key-file:list',
      'fixture:key-file:set',
      'fixture:key-file:zset',
      'fixture:key-file:stream',
    ])
  })
}

async function validateValkeyPermissionAndLargeFileEvidence(container, cli) {
  await record('Valkey: permission failure evidence for guarded writes', () => {
    const user = 'fixture_valkey_readonly'
    const password = 'datapad-readonly-fixture'

    try {
      redis(container, cli, [
        'ACL',
        'SETUSER',
        user,
        'reset',
        'on',
        `>${password}`,
        '~account:*',
        '+get',
        '+ttl',
      ])

      expectIncludes(
        redis(container, cli, ['--user', user, '-a', password, 'GET', 'account:1']),
        'Northwind',
        'Valkey readonly user can read allowed key',
      )

      const denied = redisResult(container, cli, ['--user', user, '-a', password, 'SET', 'account:1', 'blocked'])
      expectIncludes(commandOutput(denied), 'NOPERM', 'Valkey readonly user denied write')
      expectIncludes(redis(container, cli, ['GET', 'account:1']), 'Northwind', 'Valkey denied write did not mutate seed')
    } finally {
      redis(container, cli, ['ACL', 'DELUSER', user], { allowFailure: true })
    }
  })

  await record('Valkey: large key file export/import primitives', () => {
    const listKey = 'fixture:key-file:large:list'
    const listCloneKey = 'fixture:key-file:large:list:clone'
    const streamKey = 'fixture:key-file:large:stream'
    const streamCloneKey = 'fixture:key-file:large:stream:clone'
    const listValues = Array.from({ length: 256 }, (_, index) =>
      `row-${String(index).padStart(3, '0')}:${'x'.repeat(64)}`,
    )

    try {
      redis(container, cli, ['DEL', listKey, listCloneKey, streamKey, streamCloneKey])
      redis(container, cli, ['RPUSH', listKey, ...listValues])
      expectAtLeast(redis(container, cli, ['LLEN', listKey]), 256, 'Valkey large list length')
      expectIncludes(redis(container, cli, ['LRANGE', listKey, '0', '-1']), 'row-255', 'Valkey large list export read')
      redis(container, cli, ['RPUSH', listCloneKey, ...listValues])
      expectAtLeast(redis(container, cli, ['LLEN', listCloneKey]), 256, 'Valkey large list import clone length')

      for (let index = 0; index < 128; index += 1) {
        redis(container, cli, [
          'XADD',
          streamKey,
          '*',
          'seq',
          String(index),
          'payload',
          `entry-${String(index).padStart(3, '0')}:${'y'.repeat(96)}`,
        ])
        redis(container, cli, [
          'XADD',
          streamCloneKey,
          '*',
          'seq',
          String(index),
          'payload',
          `entry-${String(index).padStart(3, '0')}:${'y'.repeat(96)}`,
        ])
      }

      expectAtLeast(redis(container, cli, ['XLEN', streamKey]), 128, 'Valkey large stream length')
      expectIncludes(
        redis(container, cli, ['XRANGE', streamKey, '-', '+', 'COUNT', '128']),
        'entry-127',
        'Valkey large stream export read',
      )
      expectAtLeast(redis(container, cli, ['XLEN', streamCloneKey]), 128, 'Valkey large stream import clone length')
    } finally {
      redis(container, cli, ['DEL', listKey, listCloneKey, streamKey, streamCloneKey], { allowFailure: true })
    }
  })
}

async function validateRedisStack() {
  const container = 'datapadplusplus-redis-stack'
  const cli = 'redis-cli'

  await record('Redis Stack: RedisJSON fixture', () => {
    expectIncludes(redis(container, cli, ['JSON.GET', 'json:account:1']), 'Northwind', 'RedisJSON fixture')
  })

  await record('Redis Stack: TimeSeries fixture', () => {
    const range = redis(container, cli, ['TS.RANGE', 'ts:orders:throughput', '-', '+'])
    expectIncludes(range, '1767225600000', 'RedisTimeSeries fixture timestamp')
    expectIncludes(range, '12', 'RedisTimeSeries fixture value')
  })

  await record('Redis Stack: probabilistic module fixtures', () => {
    expectOne(redis(container, cli, ['BF.EXISTS', 'bf:seen-orders', 'order-101']), 'Bloom fixture')
    expectOne(redis(container, cli, ['CF.EXISTS', 'cf:skus', 'luna-lamp']), 'Cuckoo fixture')
    expectIncludes(redis(container, cli, ['CMS.QUERY', 'cms:regions', 'eu-west-1']), '3', 'CMS fixture')
    expectIncludes(redis(container, cli, ['TOPK.LIST', 'topk:products']), 'luna-lamp', 'TopK fixture')
    expectIncludes(redis(container, cli, ['TDIGEST.INFO', 'tdigest:latency']), 'Compression', 't-digest fixture')
  })

  await record('Redis Stack: DUMP/RESTORE module snapshot fixtures', async () => {
    const snapshotChecks = [
      {
        source: 'bf:seen-orders',
        clone: 'fixture:snapshot:bf:seen-orders',
        verify: () => expectOne(redis(container, cli, ['BF.EXISTS', 'fixture:snapshot:bf:seen-orders', 'order-101']), 'Bloom snapshot clone'),
      },
      {
        source: 'cf:skus',
        clone: 'fixture:snapshot:cf:skus',
        verify: () => expectOne(redis(container, cli, ['CF.EXISTS', 'fixture:snapshot:cf:skus', 'luna-lamp']), 'Cuckoo snapshot clone'),
      },
      {
        source: 'cms:regions',
        clone: 'fixture:snapshot:cms:regions',
        verify: () => expectIncludes(redis(container, cli, ['CMS.QUERY', 'fixture:snapshot:cms:regions', 'eu-west-1']), '3', 'CMS snapshot clone'),
      },
      {
        source: 'topk:products',
        clone: 'fixture:snapshot:topk:products',
        verify: () => expectIncludes(redis(container, cli, ['TOPK.LIST', 'fixture:snapshot:topk:products']), 'luna-lamp', 'TopK snapshot clone'),
      },
      {
        source: 'tdigest:latency',
        clone: 'fixture:snapshot:tdigest:latency',
        verify: () => expectIncludes(redis(container, cli, ['TDIGEST.INFO', 'fixture:snapshot:tdigest:latency']), 'Compression', 't-digest snapshot clone'),
      },
    ]

    for (const check of snapshotChecks) {
      await redisDumpRestore(container, check.source, check.clone)
      check.verify()
      redis(container, cli, ['DEL', check.clone])
    }
  })

  await record('Redis Stack: vector-set fixture when supported', () => {
    if (!commandSupported(container, cli, 'VADD')) {
      if (requireVector) {
        throw new Error('Redis Stack fixture does not expose VADD; select a VADD-capable image or omit --require-vector for image-independent Redis evidence.')
      }
      notes.push('Redis Stack fixture does not expose VADD; vector-set validation skipped for this image.')
      return
    }

    expectIncludes(redis(container, cli, ['VEMB', 'vectors:products', 'luna-lamp']), '0.12', 'vector embedding')
    expectIncludes(redis(container, cli, ['VGETATTR', 'vectors:products', 'luna-lamp']), 'luna-lamp', 'vector attributes')
  })
}

const coreRunning = containerRunning('datapadplusplus-redis')
const stackRunning = containerRunning('datapadplusplus-redis-stack')
const valkeyRunning = containerRunning('datapadplusplus-valkey')

if (!coreRunning) {
  throw new Error('Redis core fixture is not running. Run `npm run fixtures:up && npm run fixtures:seed` first.')
}

await validateCoreRedis()

if (stackRunning) {
  await validateRedisStack()
} else if (requireStack) {
  throw new Error('Redis Stack fixture is not running. Run `npm run fixtures:up:profile -- redis-stack` and `npm run fixtures:seed:all` first.')
} else {
  notes.push('Redis Stack fixture not running; pass --require-stack after starting the redis-stack profile for module evidence.')
}

if (valkeyRunning) {
  await validateCoreRedis('datapadplusplus-valkey', 'valkey-cli', 'Valkey')
  await validateKeyFilePrimitiveEvidence('datapadplusplus-valkey', 'valkey-cli', 'Valkey')
  await validateValkeyPermissionAndLargeFileEvidence('datapadplusplus-valkey', 'valkey-cli')
} else if (requireValkey) {
  throw new Error('Valkey fixture is not running. Run `npm run fixtures:up:profile -- cache` and `npm run fixtures:seed:all` first.')
} else {
  notes.push('Valkey fixture not running; pass --require-valkey after starting the cache profile for Valkey evidence.')
}

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error.message)
  }
}

for (const note of notes) {
  console.log(`note - ${note}`)
}

if (failures.length > 0) {
  process.exitCode = 1
}
