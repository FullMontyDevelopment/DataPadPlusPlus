import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

async function exists(relativePath) {
  try {
    await access(path.join(repoRoot, relativePath))
    return true
  } catch {
    return false
  }
}

test('quality gates enforce ownership instead of arbitrary source line budgets', async () => {
  const qualityManifest = await read('package.json')

  assert.match(qualityManifest, /node --test tests\/quality\/\*\.test\.mjs/)
  assert.equal(await exists('tests/quality/module-size.test.mjs'), false)
})

test('Rust domain models are owned by bounded modules behind the compatibility facade', async () => {
  const modules = [
    'adapter',
    'api_server',
    'connection',
    'execution',
    'library',
    'mcp_server',
    'security',
    'ui_state',
    'workspace',
  ]
  const facade = await read('apps/desktop/src-tauri/src/domain/models/mod.rs')

  for (const module of modules) {
    assert.equal(
      await exists(`apps/desktop/src-tauri/src/domain/models/${module}.rs`),
      true,
      `missing ${module} domain model owner`,
    )
    assert.match(facade, new RegExp(`mod ${module};`))
    assert.match(facade, new RegExp(`pub use ${module}::\\*;`))
  }

  assert.equal(await exists('apps/desktop/src-tauri/src/domain/models.rs'), false)
})

test('workspace commands are owned by command domains behind the existing handler facade', async () => {
  const modules = [
    'api_server',
    'connections',
    'execution',
    'import_export',
    'library',
    'mcp_server',
    'security',
    'tabs',
    'ui_state',
    'workspace_management',
  ]
  const facade = await read('apps/desktop/src-tauri/src/commands/workspace/mod.rs')

  for (const module of modules) {
    assert.equal(
      await exists(`apps/desktop/src-tauri/src/commands/workspace/${module}.rs`),
      true,
      `missing ${module} workspace command owner`,
    )
    assert.match(facade, new RegExp(`mod ${module};`))
    assert.match(facade, new RegExp(`pub use ${module}::\\*;`))
  }

  assert.equal(await exists('apps/desktop/src-tauri/src/commands/workspace.rs'), false)
})

test('adapter shell facades delegate tree and operation planning to providers', async () => {
  const treeFacade = await read(
    'apps/desktop/src-tauri/src/adapters/common/tree_manifest/mod.rs',
  )
  const planningFacade = await read(
    'apps/desktop/src-tauri/src/adapters/common/operations/planning/mod.rs',
  )
  const manifestFacade = await read(
    'apps/desktop/src-tauri/src/adapters/common/operations/manifest.rs',
  )
  const operationExecutor = await read(
    'apps/desktop/src-tauri/src/adapters/common/operations/executor.rs',
  )
  const adapterContract = await read(
    'apps/desktop/src-tauri/src/adapters/contract.rs',
  )
  const adapterCommon = await read(
    'apps/desktop/src-tauri/src/adapters/common.rs',
  )
  const adapterRuntime = await read(
    'apps/desktop/src-tauri/src/adapters/runtime.rs',
  )
  const experienceFacade = await read(
    'apps/desktop/src-tauri/src/adapters/experience.rs',
  )

  assert.match(treeFacade, /providers::tree_roots\(engine, family\)/)
  assert.doesNotMatch(treeFacade, /match\s+engine|engine\s*==/)
  assert.match(planningFacade, /providers::generated_operation_request\(/)
  assert.doesNotMatch(planningFacade, /match\s+manifest\.engine|manifest\.engine\s*==/)
  assert.match(manifestFacade, /providers::extend_mongodb\(/)
  assert.match(manifestFacade, /providers::extend_postgres\(/)
  assert.doesNotMatch(manifestFacade, /match\s+manifest\.engine|manifest\.engine\s*==/)
  assert.match(operationExecutor, /execute_guarded_operation/)
  assert.match(operationExecutor, /adapter\s*\.execute_live_operation/)
  assert.doesNotMatch(
    operationExecutor,
    /datastores::|connection\.engine\s*==|match(?:es)?!\(connection\.engine/,
  )
  assert.match(adapterContract, /execute_unsupported_live_operation/)
  assert.doesNotMatch(adapterCommon, /match\s+connection\.engine|datastores::/)
  assert.doesNotMatch(adapterRuntime, /super::datastores::|connection\.engine\s*[!=]=/)
  assert.match(experienceFacade, /providers::experience_manifest_for_manifest/)
  assert.doesNotMatch(experienceFacade, /manifest\.engine\s*==|match\s+manifest\.engine/)
})

test('application runtimes use bounded provider families', async () => {
  const requiredModules = [
    'apps/desktop/src-tauri/src/app/runtime/datastore_api_server/datastore_providers/mod.rs',
    'apps/desktop/src-tauri/src/app/runtime/datastore_mcp_server/read_policy/mod.rs',
    'apps/desktop/src-tauri/src/app/runtime/datastore_security_checks/providers.rs',
  ]

  for (const module of requiredModules) {
    assert.equal(await exists(module), true, `missing provider owner ${module}`)
  }

  const apiProviders = await read(requiredModules[0])
  const mcpPolicies = await read(requiredModules[1])
  const securityProviders = await read(requiredModules[2])

  assert.match(apiProviders, /trait ApiServerDatastoreProvider/)
  assert.match(mcpPolicies, /trait McpReadPolicy/)
  assert.match(securityProviders, /struct SecurityCheckProvider/)
  assert.match(apiProviders, /provider_registration_count/)
  assert.match(mcpPolicies, /matching_policy_count/)
  assert.match(securityProviders, /security_provider_registration_count/)
})

test('datastore Explorer and object-view registries require one explicit provider per engine', async () => {
  const connectionContracts = await read('packages/shared-types/src/connection.ts')
  const engines = [
    ...connectionContracts.matchAll(/^\s*'([a-z0-9-]+)',\s*$/gm),
  ].map((match) => match[1]).filter((engine) => ![
    'sql',
    'document',
    'keyvalue',
    'graph',
    'timeseries',
    'widecolumn',
    'search',
    'warehouse',
    'embedded-olap',
  ].includes(engine)).slice(0, 29)
  const registry = await read(
    'apps/desktop/src/app/components/workbench/datastores/registry.ts',
  )
  const types = await read(
    'apps/desktop/src/app/components/workbench/datastores/types.ts',
  )
  const browserExplorer = await read(
    'apps/desktop/src/services/runtime/browser-explorer.ts',
  )
  const commonExplorerRoot = path.join(
    repoRoot,
    'apps/desktop/src/app/components/workbench/datastores/common/explorer',
  )
  const commonExplorerFiles = (await readdir(commonExplorerRoot))
    .filter((file) => /\.(ts|tsx)$/.test(file))

  assert.match(types, /explorer:\s*DatastoreExplorerProvider/)
  assert.match(types, /objectView:\s*DatastoreObjectViewProvider/)
  assert.match(registry, /runtimeSlicesByEngine|workbenchSlicesByEngine/)
  assert.equal(await exists('apps/desktop/src/app/components/workbench/GenericObjectViewWorkspace.tsx'), false)
  assert.equal(await exists('apps/desktop/src/app/components/workbench/StructureWorkspace.tsx'), false)
  assert.doesNotMatch(browserExplorer, /objectView:\s*'unavailable'|Preview metadata is not available/)

  for (const file of commonExplorerFiles) {
    const source = await read(
      `apps/desktop/src/app/components/workbench/datastores/common/explorer/${file}`,
    )
    assert.doesNotMatch(source, /switch\s*\(\s*(?:connection\.)?engine|engine\s*===?\s*['"]/)
  }

  for (const engine of engines) {
    const source = await read(
      `apps/desktop/src/app/components/workbench/datastores/${engine}/index.ts`,
    )
    assert.match(source, /explorer:\s*/)
    assert.match(source, /objectView:\s*/)
  }
})

test('datastore test execution registry contains composition only', async () => {
  const providerRoot =
    'apps/desktop/src-tauri/src/app/runtime/tests_workbench/providers'
  const engines = [
    'dynamodb',
    'mongodb',
    'postgresql',
    'redis',
    'sqlite',
    'valkey',
  ]
  const registry = await read(
    'apps/desktop/src-tauri/src/app/runtime/tests_workbench/providers.rs',
  )
  const commonExecution = await read(`${providerRoot}/query_execution.rs`)
  const templates = await read(
    'apps/desktop/src-tauri/src/app/runtime/tests_workbench/templates.rs',
  )
  const browserRuntime = await read(
    'apps/desktop/src/services/runtime/browser-tests.ts',
  )
  const workbenchTargetFacade = await read(
    'apps/desktop/src/app/components/workbench/query-targets/test-suite-target-registry.ts',
  )
  const targetProviders = await read(
    'apps/desktop/src/services/runtime/datastore-test-target-providers.ts',
  )
  const files = (await readdir(path.join(repoRoot, providerRoot)))
    .filter((file) => file.endsWith('.rs'))
    .sort()

  assert.deepEqual(files, [...engines.map((engine) => `${engine}.rs`), 'query_execution.rs'].sort())
  assert.match(registry, /DatastoreTestExecutionProvider/)
  assert.doesNotMatch(registry, /execute_query|async_trait|tokio::|ProviderStepExecution\s*\{/)
  assert.match(commonExecution, /runtime\.execute_query\(request\)/)
  assert.match(commonExecution, /fn query_language\(&self\)/)
  assert.match(commonExecution, /fn accepted_target_kinds\(&self\)/)
  assert.match(commonExecution, /fn starter_query\(/)
  assert.doesNotMatch(
    commonExecution,
    /postgresql|sqlite|mongodb|redis|valkey|dynamodb/,
  )
  assert.doesNotMatch(templates, /match\s+.*engine|connection\.engine\s*==/)
  assert.doesNotMatch(browserRuntime, /switch\s*\(.*engine|connection\.engine\s*==/)
  assert.match(
    workbenchTargetFacade,
    /services\/runtime\/datastore-test-target-providers/,
  )
  assert.doesNotMatch(workbenchTargetFacade, /postgresql:|mongodb:|dynamodb:/)

  for (const engine of engines) {
    assert.match(registry, new RegExp(`mod ${engine};`))
    assert.match(registry, new RegExp(`Some\\(${engine}::provider\\(\\)\\)`))
    const provider = await read(`${providerRoot}/${engine}.rs`)
    assert.match(provider, new RegExp(`"${engine}-test-execution"`))
    assert.match(targetProviders, new RegExp(`${engine}: provider\\(`))
    assert.doesNotMatch(provider, /match\s+|execute_query/)
  }
})

test('workspace migration keeps one pipeline with bounded persisted-domain normalizers', async () => {
  const pipeline = await read('apps/desktop/src/app/state/workspace-migration.ts')
  const domains = ['api-server', 'mcp-server', 'security']

  for (const domain of domains) {
    assert.equal(
      await exists(`apps/desktop/src/app/state/workspace-migration/${domain}.ts`),
      true,
      `missing ${domain} migration owner`,
    )
  }

  assert.match(pipeline, /export function migrateWorkspaceSnapshot/)
  assert.match(pipeline, /normalizeDatastoreApiServerPreferences/)
  assert.match(pipeline, /normalizeDatastoreMcpServerPreferences/)
  assert.match(pipeline, /normalizeDatastoreSecurityCheckSnapshot/)
})
