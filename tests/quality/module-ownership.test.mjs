import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
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
