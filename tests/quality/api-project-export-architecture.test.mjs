import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const exportRoot =
  'apps/desktop/src-tauri/src/app/runtime/datastore_api_server/project_export'

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

test('API project export registries contain only provider, framework, and adapter composition', async () => {
  const registry = await read(`${exportRoot}/registry.rs`)

  assert.match(registry, /static CLIENT_ADAPTERS: \[&ProjectExportClientAdapter; 8\]/)
  assert.match(registry, /static FRAMEWORK_RENDERERS: \[&ProjectExportFrameworkRenderer; 2\]/)
  assert.match(
    registry,
    /static DATASTORE_PROVIDERS: \[&dyn ProjectExportDatastoreProvider; 4\]/,
  )
  assert.equal((registry.match(/&adapters::/g) ?? []).length, 8)
  assert.equal((registry.match(/&frameworks::/g) ?? []).length, 2)
  assert.equal((registry.match(/&providers::/g) ?? []).length, 4)
  assert.doesNotMatch(registry, /match\s+(framework|engine)/)
  assert.doesNotMatch(registry, /if\s+(framework|engine)/)
  assert.doesNotMatch(registry, /ProjectFile|ProjectExportSpec|render_client_files/)
})

test('shared project export modules do not select datastore behavior by engine name', async () => {
  for (const module of ['common.rs', 'model.rs', 'planner.rs']) {
    const source = await read(`${exportRoot}/${module}`)

    assert.doesNotMatch(
      source,
      /match\s+(?:connection\.)?engine\b|if\s+(?:connection\.)?engine\b|engine\s*=>/,
      `${module} must dispatch through the client-adapter registry`,
    )
    assert.doesNotMatch(
      source,
      /adapters::(?:RUST|DOTNET)_(?:POSTGRESQL|SQLITE|MONGODB|DYNAMODB)/,
      `${module} must not import a concrete client adapter`,
    )
  }
})

test('family-common export modules never import concrete provider modules', async () => {
  for (const module of [
    `${exportRoot}/common.rs`,
    `${exportRoot}/frameworks/common.rs`,
    `${exportRoot}/providers/mod.rs`,
  ]) {
    const source = await read(module)
    assert.doesNotMatch(
      source,
      /providers::(?:mongodb|dynamodb|relational)::/,
      `${module} must use public provider composition points`,
    )
  }
})
