import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import net from 'node:net'

const composeFile = 'tests/fixtures/docker-compose.yml'
const generatedEnvFile = 'tests/fixtures/.generated.env'

const profiles = [
  'cache',
  'redis-stack',
  'sqlplus',
  'analytics',
  'search',
  'graph',
  'widecolumn',
  'oracle',
  'cosmosdb',
  'cloud-contract',
]

const fixturePorts = [
  { env: 'DATAPADPLUSPLUS_POSTGRES_PORT', container: 'datapadplusplus-postgres', containerPort: 5432, defaultPort: 54329, fallbackStart: 55432, profiles: ['core'] },
  { env: 'DATAPADPLUSPLUS_MYSQL_PORT', container: 'datapadplusplus-mysql', containerPort: 3306, defaultPort: 33060, fallbackStart: 33360, profiles: ['core'] },
  { env: 'DATAPADPLUSPLUS_SQLSERVER_PORT', container: 'datapadplusplus-sqlserver', containerPort: 1433, defaultPort: 14333, fallbackStart: 15333, profiles: ['core'] },
  { env: 'DATAPADPLUSPLUS_MONGODB_PORT', container: 'datapadplusplus-mongodb', containerPort: 27017, defaultPort: 27018, fallbackStart: 27118, profiles: ['core'] },
  { env: 'DATAPADPLUSPLUS_REDIS_PORT', container: 'datapadplusplus-redis', containerPort: 6379, defaultPort: 6380, fallbackStart: 6480, profiles: ['core'] },
  { env: 'DATAPADPLUSPLUS_REDIS_STACK_PORT', container: 'datapadplusplus-redis-stack', containerPort: 6379, defaultPort: 6382, fallbackStart: 6482, profiles: ['redis-stack'] },
  { env: 'DATAPADPLUSPLUS_VALKEY_PORT', container: 'datapadplusplus-valkey', containerPort: 6379, defaultPort: 6381, fallbackStart: 6481, profiles: ['cache'] },
  { env: 'DATAPADPLUSPLUS_MEMCACHED_PORT', container: 'datapadplusplus-memcached', containerPort: 11211, defaultPort: 11212, fallbackStart: 11312, profiles: ['cache'] },
  { env: 'DATAPADPLUSPLUS_MARIADB_PORT', container: 'datapadplusplus-mariadb', containerPort: 3306, defaultPort: 33061, fallbackStart: 33361, profiles: ['sqlplus'] },
  { env: 'DATAPADPLUSPLUS_COCKROACH_PORT', container: 'datapadplusplus-cockroachdb', containerPort: 26257, defaultPort: 26257, fallbackStart: 26357, profiles: ['sqlplus'] },
  { env: 'DATAPADPLUSPLUS_COCKROACH_HTTP_PORT', container: 'datapadplusplus-cockroachdb', containerPort: 8080, defaultPort: 8080, fallbackStart: 18080, profiles: ['sqlplus'] },
  { env: 'DATAPADPLUSPLUS_TIMESCALE_PORT', container: 'datapadplusplus-timescaledb', containerPort: 5432, defaultPort: 54330, fallbackStart: 55433, profiles: ['sqlplus'] },
  { env: 'DATAPADPLUSPLUS_CLICKHOUSE_HTTP_PORT', container: 'datapadplusplus-clickhouse', containerPort: 8123, defaultPort: 8124, fallbackStart: 18124, profiles: ['analytics'] },
  { env: 'DATAPADPLUSPLUS_CLICKHOUSE_NATIVE_PORT', container: 'datapadplusplus-clickhouse', containerPort: 9000, defaultPort: 9001, fallbackStart: 19001, profiles: ['analytics'] },
  { env: 'DATAPADPLUSPLUS_INFLUXDB_PORT', container: 'datapadplusplus-influxdb', containerPort: 8086, defaultPort: 8087, fallbackStart: 18087, profiles: ['analytics'] },
  { env: 'DATAPADPLUSPLUS_PROMETHEUS_PORT', container: 'datapadplusplus-prometheus', containerPort: 9090, defaultPort: 9091, fallbackStart: 19091, profiles: ['analytics'] },
  { env: 'DATAPADPLUSPLUS_OPENSEARCH_PORT', container: 'datapadplusplus-opensearch', containerPort: 9200, defaultPort: 9201, fallbackStart: 19201, profiles: ['search'] },
  { env: 'DATAPADPLUSPLUS_ELASTICSEARCH_PORT', container: 'datapadplusplus-elasticsearch', containerPort: 9200, defaultPort: 9202, fallbackStart: 19202, profiles: ['search'] },
  { env: 'DATAPADPLUSPLUS_NEO4J_HTTP_PORT', container: 'datapadplusplus-neo4j', containerPort: 7474, defaultPort: 7475, fallbackStart: 17475, profiles: ['graph'] },
  { env: 'DATAPADPLUSPLUS_NEO4J_BOLT_PORT', container: 'datapadplusplus-neo4j', containerPort: 7687, defaultPort: 7688, fallbackStart: 17688, profiles: ['graph'] },
  { env: 'DATAPADPLUSPLUS_ARANGODB_PORT', container: 'datapadplusplus-arangodb', containerPort: 8529, defaultPort: 8529, fallbackStart: 18529, profiles: ['graph'] },
  { env: 'DATAPADPLUSPLUS_JANUSGRAPH_PORT', container: 'datapadplusplus-janusgraph', containerPort: 8182, defaultPort: 8183, fallbackStart: 18183, profiles: ['graph'] },
  { env: 'DATAPADPLUSPLUS_CASSANDRA_PORT', container: 'datapadplusplus-cassandra', containerPort: 9042, defaultPort: 9043, fallbackStart: 19043, profiles: ['widecolumn'] },
  { env: 'DATAPADPLUSPLUS_ORACLE_PORT', container: 'datapadplusplus-oracle', containerPort: 1521, defaultPort: 1522, fallbackStart: 11522, profiles: ['oracle'] },
  { env: 'DATAPADPLUSPLUS_DYNAMODB_PORT', container: 'datapadplusplus-dynamodb', containerPort: 8000, defaultPort: 8001, fallbackStart: 18001, profiles: ['cloud-contract'] },
  { env: 'DATAPADPLUSPLUS_COSMOSDB_EMULATOR_PORT', container: 'datapadplusplus-cosmosdb', containerPort: 8081, defaultPort: 8082, fallbackStart: 18082, profiles: ['cosmosdb'] },
  { env: 'DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT', container: 'datapadplusplus-cosmosdb', containerPort: 8080, defaultPort: 18082, fallbackStart: 18182, profiles: ['cosmosdb'] },
  { env: 'DATAPADPLUSPLUS_COSMOSDB_EXPLORER_PORT', container: 'datapadplusplus-cosmosdb', containerPort: 1234, defaultPort: 1235, fallbackStart: 11235, profiles: ['cosmosdb'] },
  { env: 'DATAPADPLUSPLUS_BIGQUERY_MOCK_PORT', container: 'datapadplusplus-cloud-contract', containerPort: 19050, defaultPort: 19050, fallbackStart: 19150, profiles: ['cloud-contract'] },
  { env: 'DATAPADPLUSPLUS_SNOWFLAKE_MOCK_PORT', container: 'datapadplusplus-cloud-contract', containerPort: 19060, defaultPort: 19060, fallbackStart: 19160, profiles: ['cloud-contract'] },
  { env: 'DATAPADPLUSPLUS_COSMOSDB_MOCK_PORT', container: 'datapadplusplus-cloud-contract', containerPort: 19070, defaultPort: 19070, fallbackStart: 19170, profiles: ['cloud-contract'] },
  { env: 'DATAPADPLUSPLUS_NEPTUNE_MOCK_PORT', container: 'datapadplusplus-cloud-contract', containerPort: 19080, defaultPort: 19080, fallbackStart: 19180, profiles: ['cloud-contract'] },
]

function runDocker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: options.encoding,
    stdio: options.stdio ?? 'inherit',
    shell: false,
  })
}

function runDockerCompose(args, env) {
  const result = runDocker(['compose', '--env-file', generatedEnvFile, '-f', composeFile, ...args], {
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function runDockerComposeWithRecovery(args, env) {
  let lastError = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      runDockerCompose(args, env)
      const staleServices = staleCoreFixtureServices()

      if (staleServices.length === 0) {
        return
      }

      console.warn(
        `Fixture credential validation failed for ${staleServices.join(', ')}; recreating stale fixture container(s).`,
      )
      recreateComposeServices(staleServices, env)
      continue
    } catch (error) {
      lastError = error

      if (!args.includes('up')) {
        throw error
      }

      const staleServices = staleCoreFixtureServices()
      const servicesToRecreate =
        staleServices.length > 0
          ? staleServices
          : mongoFixtureNeedsRecreate()
            ? ['mongodb']
            : []

      if (servicesToRecreate.length === 0) {
        throw error
      }

      console.warn(
        `Fixture startup failed because ${servicesToRecreate.join(', ')} has stale local state; recreating and retrying.`,
      )
      recreateComposeServices(servicesToRecreate, env)
    }
  }

  throw lastError ?? new Error(`docker compose ${args.join(' ')} failed`)
}

function dockerOutput(args) {
  const result = runDocker(args, { encoding: 'utf8', stdio: 'pipe' })

  if (result.status !== 0) {
    return ''
  }

  return result.stdout.trim()
}

function dockerSucceeds(args) {
  const result = runDocker(args, { stdio: 'ignore' })
  return result.status === 0
}

function recreateComposeServices(services, env) {
  const removeResult = runDocker(
    ['compose', '--env-file', generatedEnvFile, '-f', composeFile, 'rm', '-sf', ...services],
    {
      env,
      stdio: 'inherit',
    },
  )

  if (removeResult.status !== 0) {
    throw new Error(`Failed to recreate stale fixture service(s): ${services.join(', ')}`)
  }
}

function mongoFixtureNeedsRecreate() {
  const health = dockerOutput([
    'inspect',
    '--format',
    '{{json .State.Health}}',
    'datapadplusplus-mongodb',
  ])

  return /Authentication failed|UserNotFound|Could not find user/i.test(health)
}

function staleCoreFixtureServices() {
  const stale = []

  if (
    dockerOutput(['inspect', '-f', '{{.State.Running}}', 'datapadplusplus-postgres']) === 'true' &&
    !dockerSucceeds([
      'exec',
      '-e',
      'PGPASSWORD=datapadplusplus',
      'datapadplusplus-postgres',
      'psql',
      '-U',
      'datapadplusplus',
      '-d',
      'datapadplusplus',
      '-c',
      'select 1',
    ])
  ) {
    stale.push('postgres')
  }

  if (
    dockerOutput(['inspect', '-f', '{{.State.Running}}', 'datapadplusplus-mysql']) === 'true' &&
    !dockerSucceeds([
      'exec',
      'datapadplusplus-mysql',
      'mysql',
      '-udatapadplusplus',
      '-pdatapadplusplus',
      'commerce',
      '-e',
      'select 1',
    ])
  ) {
    stale.push('mysql')
  }

  if (
    dockerOutput(['inspect', '-f', '{{.State.Running}}', 'datapadplusplus-mongodb']) === 'true' &&
    !dockerSucceeds([
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
      '--eval',
      'db.adminCommand({ ping: 1 })',
    ])
  ) {
    stale.push('mongodb')
  }

  return stale
}

function mappedContainerPort(container, containerPort) {
  const output = dockerOutput(['port', container, `${containerPort}/tcp`])
  const match = output.match(/:(\d+)\s*$/m)

  return match ? Number(match[1]) : undefined
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '0.0.0.0')
  })
}

async function availablePort(defaultPort, fallbackStart) {
  if (await canBind(defaultPort)) {
    return defaultPort
  }

  for (let offset = 0; offset < 100; offset += 1) {
    const candidate = fallbackStart + offset

    if (await canBind(candidate)) {
      return candidate
    }
  }

  throw new Error(`Unable to find an available host port near ${fallbackStart}`)
}

async function buildComposeEnvironment(selectedProfiles) {
  const env = { ...process.env }
  const selected = new Set(['core', ...selectedProfiles])
  const lines = [
    '# Generated by tests/fixtures/compose.mjs.',
    '# Delete this file to force fresh fixture port detection.',
  ]

  for (const config of fixturePorts) {
    if (!config.profiles.some((profile) => selected.has(profile))) {
      continue
    }

    const explicit = process.env[config.env]
    const mapped = explicit ? undefined : mappedContainerPort(config.container, config.containerPort)
    const port = Number(explicit ?? mapped ?? (await availablePort(config.defaultPort, config.fallbackStart)))

    env[config.env] = String(port)
    lines.push(`${config.env}=${port}`)

    if (!explicit && !mapped && port !== config.defaultPort) {
      console.log(
        `Fixture port ${config.defaultPort} is unavailable; using ${config.env}=${port}.`,
      )
    }
  }

  writeFileSync(generatedEnvFile, `${lines.join('\n')}\n`)
  return env
}

const [command, profile] = process.argv.slice(2)

switch (command) {
  case 'up': {
    const env = await buildComposeEnvironment([])
    runDockerComposeWithRecovery(['up', '-d', '--wait'], env)
    break
  }
  case 'up-profile': {
    if (!profile) {
      throw new Error(`Usage: npm run fixtures:up:profile -- <${profiles.join('|')}>`)
    }
    if (!profiles.includes(profile)) {
      throw new Error(`Unknown fixture profile "${profile}". Valid profiles: ${profiles.join(', ')}`)
    }
    const env = await buildComposeEnvironment([profile])
    runDockerComposeWithRecovery(['--profile', profile, 'up', '-d', '--wait'], env)
    break
  }
  case 'up-all': {
    const env = await buildComposeEnvironment(profiles)
    runDockerComposeWithRecovery([
      ...profiles.flatMap((item) => ['--profile', item]),
      'up',
      '-d',
      '--wait',
    ], env)
    break
  }
  default:
    throw new Error('Usage: node tests/fixtures/compose.mjs <up|up-profile|up-all> [profile]')
}
