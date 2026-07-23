import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { connect as connectHttp2 } from 'node:http2'
import { DatabaseSync } from 'node:sqlite'

const repositoryRoot = resolve(import.meta.dirname, '..')
const cargoTarget = join(
  repositoryRoot,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  'generated-api-projects',
)
const fullMatrix = process.argv.includes('--full')
const liveSqlite = process.argv.includes('--live-sqlite')
const liveMongoDb = process.argv.includes('--live-mongodb')
const liveDynamoDb = process.argv.includes('--live-dynamodb')
const requestedMatrix = fullMatrix
  ? [
      ...combinations('rust'),
      ...combinations('dotnet'),
    ]
  : [
      ['rust', 'sqlite', 'rest'],
      ['rust', 'postgresql', 'graphql'],
      ['dotnet', 'sqlite', 'grpc'],
      ['dotnet', 'postgresql', 'rest'],
      ['rust', 'mongodb', 'rest'],
      ['dotnet', 'mongodb', 'graphql'],
      ['rust', 'dynamodb', 'grpc'],
      ['dotnet', 'dynamodb', 'rest'],
    ]
const matrix = uniqueCombinations(
  [
    ...requestedMatrix,
    ...(liveSqlite
      ? [
          ['rust', 'sqlite', 'graphql'],
          ['rust', 'sqlite', 'grpc'],
          ['dotnet', 'sqlite', 'rest'],
        ]
      : []),
    ...(liveMongoDb
      ? [
          ['rust', 'mongodb', 'rest'],
          ['dotnet', 'mongodb', 'rest'],
          ['rust', 'mongodb', 'grpc'],
          ['dotnet', 'mongodb', 'graphql'],
        ]
      : []),
    ...(liveDynamoDb
      ? [
          ['rust', 'dynamodb', 'rest'],
          ['dotnet', 'dynamodb', 'rest'],
          ['dotnet', 'dynamodb', 'graphql'],
          ['rust', 'dynamodb', 'grpc'],
        ]
      : []),
  ],
)
const destination = await mkdtemp(join(tmpdir(), 'datapad-api-export-'))

try {
  run('cargo', [
    'test',
    '--manifest-path',
    'apps/desktop/src-tauri/Cargo.toml',
    'emit_generated_project_matrix',
    '--',
    '--ignored',
  ], {
    DATAPAD_PROJECT_EXPORT_MATRIX_DIR: destination,
  })

  for (const [framework, engine, protocol] of matrix) {
    const project = join(destination, `${framework}-${engine}-${protocol}`)
    console.log(`Validating generated ${framework}/${engine}/${protocol} project`)
    if (framework === 'rust') {
      run('cargo', ['check', '--quiet'], {
        CARGO_TARGET_DIR: cargoTarget,
        CARGO_INCREMENTAL: '0',
      }, project)
    } else {
      run('dotnet', [
        'build',
        '--nologo',
        '--configuration',
        'Release',
        '--verbosity',
        'minimal',
      ], {}, project)
    }
  }
  if (liveSqlite) {
    await validateLiveSqliteProjects(destination)
  }
  if (liveMongoDb) await validateLiveMongoDbProjects(destination)
  if (liveDynamoDb) await validateLiveDynamoDbProjects(destination)
} finally {
  await rm(destination, { recursive: true, force: true })
}

function uniqueCombinations(combinationsToCheck) {
  const seen = new Set()
  return combinationsToCheck.filter((combination) => {
    const key = combination.join('/')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function combinations(framework) {
  return ['postgresql', 'sqlite', 'mongodb', 'dynamodb'].flatMap((engine) =>
    ['rest', 'graphql', 'grpc'].map((protocol) => [
      framework,
      engine,
      protocol,
    ]),
  )
}

function run(command, args, extraEnvironment = {}, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
}

async function validateLiveSqliteProjects(outputRoot) {
  const databasePath = join(outputRoot, 'fixture.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE
    )
  `)
  database.close()

  const rustProject = join(outputRoot, 'rust-sqlite-rest')
  run('cargo', ['build', '--quiet'], {
    CARGO_TARGET_DIR: cargoTarget,
    CARGO_INCREMENTAL: '0',
  }, rustProject)
  const executableExtension = process.platform === 'win32' ? '.exe' : ''
  await validateLiveService(
    'Rust/SQLite/REST',
    join(cargoTarget, 'debug', `rust_sqlite_rest_api${executableExtension}`),
    rustProject,
    {
      DATABASE_URL: sqliteUrl(databasePath),
    },
  )

  const dotnetProject = join(outputRoot, 'dotnet-sqlite-rest')
  const dotnetExecutable = join(
    dotnetProject,
    'bin',
    'Release',
    'net10.0',
    `DotnetSqliteRestApi${executableExtension}`,
  )
  await validateLiveService(
    '.NET/SQLite/REST',
    dotnetExecutable,
    dotnetProject,
    {
      ConnectionStrings__Datastore: `Data Source=${databasePath}`,
      ASPNETCORE_URLS: 'http://127.0.0.1:8080',
    },
  )

  await validateLiveGraphqlProject(outputRoot, databasePath)
  await validateLiveGrpcProject(outputRoot, databasePath)
}

async function validateLiveMongoDbProjects(outputRoot) {
  if (!containerRunning('datapadplusplus-mongodb')) {
    console.log('Skipping generated MongoDB live validation: fixture container is not running.')
    return
  }
  const port = fixturePort('DATAPADPLUSPLUS_MONGODB_PORT', 27018)
  const environment = {
    MONGODB_URI:
      `mongodb://datapadplusplus:datapadplusplus@127.0.0.1:${port}/catalog` +
      '?authSource=admin&directConnection=true',
  }
  for (const framework of ['rust', 'dotnet']) {
    const project = join(outputRoot, `${framework}-mongodb-rest`)
    const executable = await buildGeneratedExecutable(
      framework,
      'mongodb',
      'rest',
      project,
    )
    const running = startService(executable, project, environment)
    const label = `${framework}/MongoDB/REST`
    console.log(`Running live fixture checks for generated ${label} project`)
    try {
      await waitForHealth(running.process)
      const created = await requestJson('/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          values: {
            name: `Generated ${framework} MongoDB`,
            status: 'created',
            nested: { verified: true },
          },
        }),
      })
      const identity = encodeURIComponent(JSON.stringify({ _id: created._id }))
      const fetched = await requestJson(`/users/${identity}`)
      assert(fetched.status === 'created', `${label} get returned the wrong document`)
      const patched = await requestJson(`/users/${identity}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { status: 'patched' } }),
      })
      assert(patched.status === 'patched', `${label} patch did not persist changes`)
      await requestJson(`/users/${identity}`, { method: 'DELETE' })
      const missing = await fetch(`http://127.0.0.1:8080/users/${identity}`)
      assert(missing.status === 404, `${label} missing document was not distinguished`)
    } catch (error) {
      throw serviceError(error, running)
    } finally {
      await stopService(running.process)
    }
  }
  await validateLiveDocumentProtocols(outputRoot, 'mongodb', environment)
}

async function validateLiveDynamoDbProjects(outputRoot) {
  if (!containerRunning('datapadplusplus-dynamodb')) {
    console.log('Skipping generated DynamoDB live validation: fixture container is not running.')
    return
  }
  const port = fixturePort('DATAPADPLUSPLUS_DYNAMODB_PORT', 8001)
  const environment = {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'local',
    AWS_SECRET_ACCESS_KEY: 'local',
    DYNAMODB_ENDPOINT_URL: `http://127.0.0.1:${port}`,
  }
  for (const framework of ['rust', 'dotnet']) {
    const project = join(outputRoot, `${framework}-dynamodb-rest`)
    const executable = await buildGeneratedExecutable(
      framework,
      'dynamodb',
      'rest',
      project,
    )
    const running = startService(executable, project, {
      ...environment,
      ASPNETCORE_URLS: 'http://127.0.0.1:8080',
    })
    const label = `${framework}/DynamoDB/REST`
    console.log(`Running live fixture checks for generated ${label} project`)
    const suffix = `${framework}-${Date.now()}`
    const key = { pk: `generated#${suffix}`, sk: 'event#1' }
    const identity = encodeURIComponent(JSON.stringify(key))
    try {
      await waitForHealth(running.process)
      const created = await requestJson('/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          values: {
            ...key,
            status: 'created',
            amount: { $number: '1234567890.123456789' },
            payload: { $binary: 'AQIDBA==' },
            tags: { $stringSet: ['generated', framework] },
          },
        }),
      })
      assert(created.amount?.$number === '1234567890.123456789', `${label} lost number precision`)
      const duplicate = await fetch('http://127.0.0.1:8080/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { ...key, status: 'duplicate' } }),
      })
      assert(duplicate.status === 400, `${label} duplicate create was not rejected`)
      const fetched = await requestJson(`/users/${identity}`)
      assert(fetched.pk === key.pk && fetched.sk === key.sk, `${label} get returned the wrong key`)
      const patched = await requestJson(`/users/${identity}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { status: 'patched' } }),
      })
      assert(patched.status === 'patched', `${label} conditional patch did not persist`)
      const deleted = await requestJson(`/users/${identity}`, { method: 'DELETE' })
      assert(deleted.pk === key.pk, `${label} delete did not return the removed item`)
    } catch (error) {
      throw serviceError(error, running)
    } finally {
      await stopService(running.process)
    }
  }
  await validateLiveDocumentProtocols(outputRoot, 'dynamodb', environment)
}

async function validateLiveDocumentProtocols(outputRoot, engine, environment) {
  const graphqlFramework = 'dotnet'
  const graphqlProject = join(
    outputRoot,
    `${graphqlFramework}-${engine}-graphql`,
  )
  const graphqlExecutable = await buildGeneratedExecutable(
    graphqlFramework,
    engine,
    'graphql',
    graphqlProject,
  )
  const graphql = startService(graphqlExecutable, graphqlProject, {
    ...environment,
    ASPNETCORE_URLS: 'http://127.0.0.1:8080',
  })
  try {
    await waitForHealth(graphql.process)
    const response = await requestJson('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ users(limit: 2) { document } }' }),
    })
    assert(
      response.data?.users?.length > 0
        && response.data.users[0].document !== undefined,
      `.NET/${engine}/GraphQL did not return a real normalized document`,
    )
  } catch (error) {
    throw serviceError(error, graphql)
  } finally {
    await stopService(graphql.process)
  }

  const grpcFramework = 'rust'
  const grpcProject = join(outputRoot, `${grpcFramework}-${engine}-grpc`)
  const grpcExecutable = await buildGeneratedExecutable(
    grpcFramework,
    engine,
    'grpc',
    grpcProject,
  )
  const grpc = startService(grpcExecutable, grpcProject, environment)
  try {
    const rows = await waitForGrpcRows(grpc.process)
    assert(
      rows.length > 0 && typeof rows[0] === 'object',
      `Rust/${engine}/gRPC did not return real normalized documents`,
    )
  } catch (error) {
    throw serviceError(error, grpc)
  } finally {
    await stopService(grpc.process)
  }
}

async function buildGeneratedExecutable(framework, engine, protocol, project) {
  const executableExtension = process.platform === 'win32' ? '.exe' : ''
  const projectName = `${pascal(framework)}${pascal(engine)}${pascal(protocol)}Api`
  if (framework === 'rust') {
    run('cargo', ['build', '--quiet'], {
      CARGO_TARGET_DIR: cargoTarget,
      CARGO_INCREMENTAL: '0',
    }, project)
    return join(cargoTarget, 'debug', `${snake(projectName)}${executableExtension}`)
  }
  run('dotnet', [
    'build',
    '--nologo',
    '--configuration',
    'Release',
    '--verbosity',
    'minimal',
  ], {}, project)
  return join(project, 'bin', 'Release', 'net10.0', `${projectName}${executableExtension}`)
}

function containerRunning(name) {
  const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return result.status === 0 && result.stdout.trim() === 'true'
}

function fixturePort(name, fallback) {
  const generatedEnvironment = join(
    repositoryRoot,
    'tests',
    'fixtures',
    '.generated.env',
  )
  const generatedValue = existsSync(generatedEnvironment)
    ? readFileSync(generatedEnvironment, 'utf8')
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${name}=`))
        ?.slice(name.length + 1)
        .trim()
    : undefined
  const value = Number(process.env[name] ?? generatedValue ?? fallback)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function pascal(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function snake(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toLowerCase()
}

async function validateLiveService(label, executable, cwd, extraEnvironment) {
  console.log(`Running live fixture checks for generated ${label} project`)
  const running = startService(executable, cwd, extraEnvironment)

  try {
    await waitForHealth(running.process)
    const created = await requestJson('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { email: `${label.toLowerCase()}@example.test` } }),
    })
    assert(created.id > 0, `${label} create did not return a generated identity`)

    const rows = await requestJson('/users?limit=100')
    assert(rows.length === 1, `${label} list did not return the created row`)

    const fetched = await requestJson(`/users/${created.id}`)
    assert(fetched.email === created.email, `${label} get returned the wrong row`)

    const changedEmail = `changed-${created.email}`
    const patched = await requestJson(`/users/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { email: changedEmail } }),
    })
    assert(patched.email === changedEmail, `${label} patch did not persist changes`)

    const customRows = await requestJson(
      `/users-by-email?email=${encodeURIComponent(changedEmail)}`,
    )
    assert(
      customRows.length === 1 && customRows[0].email === changedEmail,
      `${label} parameterized custom read returned the wrong rows`,
    )

    const deleted = await requestJson(`/users/${created.id}`, { method: 'DELETE' })
    assert(deleted.deleted === true, `${label} delete did not report success`)
    const afterDelete = await requestJson('/users?limit=100')
    assert(afterDelete.length === 0, `${label} delete did not remove the row`)
  } catch (error) {
    throw serviceError(error, running)
  } finally {
    await stopService(running.process)
  }
}

async function validateLiveGraphqlProject(outputRoot, databasePath) {
  const project = join(outputRoot, 'rust-sqlite-graphql')
  run('cargo', ['build', '--quiet'], {
    CARGO_TARGET_DIR: cargoTarget,
    CARGO_INCREMENTAL: '0',
  }, project)
  const executableExtension = process.platform === 'win32' ? '.exe' : ''
  const email = 'graphql@example.test'
  replaceFixtureRow(databasePath, email)
  const running = startService(
    join(cargoTarget, 'debug', `rust_sqlite_graphql_api${executableExtension}`),
    project,
    { DATABASE_URL: sqliteUrl(databasePath) },
  )
  console.log('Running live fixture checks for generated Rust/SQLite/GraphQL project')
  try {
    await waitForHealth(running.process)
    const response = await requestJson('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ users(limit: 10) { id email } }' }),
    })
    assert(
      response.data?.users?.length === 1 && response.data.users[0].email === email,
      'Rust/SQLite/GraphQL did not return the fixture repository row',
    )
  } catch (error) {
    throw serviceError(error, running)
  } finally {
    await stopService(running.process)
    clearFixtureRows(databasePath)
  }
}

async function validateLiveGrpcProject(outputRoot, databasePath) {
  const project = join(outputRoot, 'rust-sqlite-grpc')
  run('cargo', ['build', '--quiet'], {
    CARGO_TARGET_DIR: cargoTarget,
    CARGO_INCREMENTAL: '0',
  }, project)
  const executableExtension = process.platform === 'win32' ? '.exe' : ''
  const email = 'grpc@example.test'
  replaceFixtureRow(databasePath, email)
  const running = startService(
    join(cargoTarget, 'debug', `rust_sqlite_grpc_api${executableExtension}`),
    project,
    { DATABASE_URL: sqliteUrl(databasePath) },
  )
  console.log('Running live fixture checks for generated Rust/SQLite/gRPC project')
  try {
    const rows = await waitForGrpcRows(running.process)
    assert(
      rows.length === 1 && rows[0].email === email,
      'Rust/SQLite/gRPC did not return the fixture repository row',
    )
  } catch (error) {
    throw serviceError(error, running)
  } finally {
    await stopService(running.process)
    clearFixtureRows(databasePath)
  }
}

function startService(executable, cwd, extraEnvironment) {
  const process = spawn(executable, [], {
    cwd,
    env: { ...globalThis.process.env, ...extraEnvironment },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  process.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-12_000)
  })
  process.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-12_000)
  })
  return { process, output: () => output }
}

function serviceError(error, running) {
  return new Error(`${error.message}\nGenerated service output:\n${running.output()}`)
}

function sqliteUrl(databasePath) {
  return `sqlite://${databasePath.replaceAll('\\', '/')}?mode=rwc`
}

function replaceFixtureRow(databasePath, email) {
  const database = new DatabaseSync(databasePath)
  database.exec('DELETE FROM users')
  database.prepare('INSERT INTO users (email) VALUES (?)').run(email)
  database.close()
}

function clearFixtureRows(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.exec('DELETE FROM users')
  database.close()
}

async function waitForHealth(service) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (service.exitCode !== null) {
      throw new Error(`generated service exited with status ${service.exitCode}`)
    }
    try {
      const health = await requestJson('/health')
      if (health.ok === true && health.datastoreConnected === true) return
    } catch {
      // The generated host is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error('generated service did not become healthy within 120 seconds')
}

async function waitForGrpcRows(service) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (service.exitCode !== null) {
      throw new Error(`generated gRPC service exited with status ${service.exitCode}`)
    }
    try {
      return await grpcSearch()
    } catch {
      // The generated host is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error('generated gRPC service did not respond within 120 seconds')
}

function grpcSearch() {
  return new Promise((resolveRows, rejectRows) => {
    const client = connectHttp2('http://127.0.0.1:8080')
    let settled = false
    const finish = (error, rows) => {
      if (settled) return
      settled = true
      client.close()
      if (error) rejectRows(error)
      else resolveRows(rows)
    }
    client.on('error', (error) => finish(error))
    const request = client.request({
      ':method': 'POST',
      ':path': '/datapad.api.UsersService/Search',
      'content-type': 'application/grpc',
      te: 'trailers',
    })
    const chunks = []
    let status = 0
    let grpcStatus = '0'
    request.on('response', (headers) => {
      status = Number(headers[':status'])
    })
    request.on('trailers', (trailers) => {
      grpcStatus = String(trailers['grpc-status'] ?? '0')
    })
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('error', (error) => finish(error))
    request.on('end', () => {
      try {
        if (status !== 200 || grpcStatus !== '0') {
          throw new Error(`gRPC search returned HTTP ${status} / status ${grpcStatus}`)
        }
        const frame = Buffer.concat(chunks)
        if (frame.length < 7 || frame[0] !== 0) {
          throw new Error('gRPC search returned an invalid response frame')
        }
        const messageLength = frame.readUInt32BE(1)
        const message = frame.subarray(5, 5 + messageLength)
        if (message[0] !== 0x0a) {
          throw new Error('gRPC search returned an unexpected protobuf payload')
        }
        const [jsonLength, jsonOffset] = readVarint(message, 1)
        const json = message.subarray(jsonOffset, jsonOffset + jsonLength).toString('utf8')
        finish(null, JSON.parse(json))
      } catch (error) {
        finish(error)
      }
    })
    request.end(Buffer.from([0, 0, 0, 0, 2, 0x08, 100]))
  })
}

function readVarint(buffer, start) {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset]
    value |= (byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) return [value, offset]
    shift += 7
  }
  throw new Error('protobuf varint is truncated')
}

async function requestJson(path, options) {
  const response = await fetch(`http://127.0.0.1:8080${path}`, options)
  const textBody = await response.text()
  const body = textBody ? JSON.parse(textBody) : null
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${path} returned ${response.status}: ${textBody}`)
  }
  return body
}

async function stopService(service) {
  if (service.exitCode !== null) return
  service.kill()
  await Promise.race([
    new Promise((resolveExit) => service.once('exit', resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ])
  if (service.exitCode === null) service.kill('SIGKILL')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
