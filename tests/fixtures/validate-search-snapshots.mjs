import { spawnSync } from 'node:child_process'

const composeFiles = [
  '-f', 'tests/fixtures/docker-compose.yml',
  '-f', 'tests/fixtures/docker-compose.search-snapshots.yml',
]
const engines = [
  {
    label: 'Elasticsearch',
    endpoint: 'http://127.0.0.1:9202',
    location: '/usr/share/elasticsearch/data/snapshots',
    sourceIndex: 'datapad-snapshot-source-elasticsearch',
    targetIndex: 'datapad-snapshot-target-elasticsearch',
  },
  {
    label: 'OpenSearch',
    endpoint: 'http://127.0.0.1:9201',
    location: '/usr/share/opensearch/data/snapshots',
    sourceIndex: 'datapad-snapshot-source-opensearch',
    targetIndex: 'datapad-snapshot-target-opensearch',
  },
]
const repository = 'datapad-fixtures'
const snapshot = 'native-roundtrip'

function command(program, args, options = {}) {
  return spawnSync(program, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  })
}

function commandOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

async function request(engine, method, path, body, allowedStatuses = []) {
  const response = await fetch(`${engine.endpoint}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`${engine.label} ${method} ${path} failed: ${response.status} ${text}`)
  }
  return { status: response.status, text }
}

async function waitForSearch(engine) {
  let lastError
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await request(engine, 'GET', '/')
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for ${engine.label}: ${lastError?.message ?? 'unknown error'}`)
}

async function cleanup(engine) {
  await request(engine, 'DELETE', `/${engine.sourceIndex}`, undefined, [404])
  await request(engine, 'DELETE', `/${engine.targetIndex}`, undefined, [404])
  await request(engine, 'DELETE', `/_snapshot/${repository}/${snapshot}`, undefined, [404])
}

const started = command('docker', [
  'compose',
  ...composeFiles,
  '--profile', 'search',
  'up', '-d',
  'elasticsearch', 'opensearch',
])
if (started.status !== 0) {
  process.stderr.write(commandOutput(started))
  process.exit(1)
}

let failed = false
try {
  for (const engine of engines) {
    await waitForSearch(engine)
    await cleanup(engine)
    await request(engine, 'PUT', `/_snapshot/${repository}`, {
      type: 'fs',
      settings: {
        location: engine.location,
        compress: true,
      },
    })
  }

  const result = command(
    'cargo',
    [
      'test',
      '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml',
      '--lib',
      'search_live_snapshot_round_trips_both_engines_into_new_indices',
      '--', '--nocapture',
    ],
    {
      env: {
        ...process.env,
        DATAPADPLUSPLUS_FIXTURE_RUN: '1',
      },
    },
  )
  process.stdout.write(commandOutput(result))
  failed = result.status !== 0
} catch (error) {
  console.error(error.message)
  failed = true
} finally {
  for (const engine of engines) {
    try {
      await cleanup(engine)
      await request(engine, 'DELETE', `/_snapshot/${repository}`, undefined, [404])
    } catch (error) {
      console.error(`${engine.label} snapshot cleanup failed: ${error.message}`)
      failed = true
    }
  }
}

if (failed) {
  process.exitCode = 1
} else {
  console.log('ok - Elasticsearch/OpenSearch: registered repository boundary, native index snapshot, post-backup mutation isolation, create-new restore, mappings/type fidelity, duplicate conflict rejection, rollback contract, and cleanup')
}
