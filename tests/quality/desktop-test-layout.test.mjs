import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const desktopSrc = 'apps/desktop/src'
const desktopTests = 'apps/desktop/tests'
const desktopRustSrc = 'apps/desktop/src-tauri/src'
const desktopRustTests = 'apps/desktop/src-tauri/tests'
const desktopRustUnitTests = `${desktopRustTests}/unit`

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath)
}

async function exists(relativePath) {
  try {
    await access(absolutePath(relativePath))
    return true
  } catch {
    return false
  }
}

async function sourceFiles(relativePath, predicate = () => true) {
  const found = []

  for (const entry of await readdir(absolutePath(relativePath), { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name)

    if (entry.isDirectory()) {
      found.push(...await sourceFiles(child, predicate))
    } else if (predicate(entry.name)) {
      found.push(child.split(path.sep).join('/'))
    }
  }

  return found
}

test('desktop application source tree does not contain colocated tests', async () => {
  const failures = []
  const colocatedTests = await sourceFiles(desktopSrc, (fileName) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName),
  )
  const colocatedRustTests = await sourceFiles(desktopRustSrc, (fileName) =>
    /(^tests\.rs$|_tests\.rs$)/.test(fileName),
  )

  failures.push(...colocatedTests.map((file) => `${file}: move tests under ${desktopTests}`))
  failures.push(
    ...colocatedRustTests.map((file) => `${file}: move tests under ${desktopRustUnitTests}`),
  )

  if (await exists(`${desktopSrc}/test`)) {
    failures.push(`${desktopSrc}/test: move test support files under ${desktopTests}`)
  }

  assert.deepEqual(failures, [])
})

test('desktop tests use source-mirroring datastore and common folders', async () => {
  const expectedRoots = [
    `${desktopTests}/app`,
    `${desktopTests}/services/runtime`,
    `${desktopTests}/app/components/workbench/datastores/common`,
    `${desktopTests}/services/runtime/datastores/common`,
  ]
  const expectedDatastoreRoots = [
    `${desktopTests}/app/components/workbench/datastores/mongodb`,
    `${desktopTests}/app/components/workbench/datastores/cassandra`,
    `${desktopTests}/app/components/workbench/datastores/dynamodb`,
    `${desktopTests}/services/runtime/datastores/mongodb`,
  ]
  const expectedRustRoots = [
    `${desktopRustUnitTests}/adapters/common`,
    `${desktopRustUnitTests}/adapters/datastores/mongodb`,
    `${desktopRustUnitTests}/adapters/datastores/memcached`,
    `${desktopRustUnitTests}/adapters/datastores/redis`,
  ]
  const failures = []

  for (const root of [...expectedRoots, ...expectedDatastoreRoots, ...expectedRustRoots]) {
    if (!(await exists(root))) {
      failures.push(`${root}: missing expected test folder`)
    }
  }

  assert.deepEqual(failures, [])
})

test('desktop Rust source delegates unit test bodies to mirrored test files', async () => {
  const rustFiles = await sourceFiles(desktopRustSrc, (fileName) => fileName.endsWith('.rs'))
  const inlineTestModulePattern =
    /#\[cfg\(test\)\]\s*(?:\r?\n#\[[^\r\n]*\]\s*)*\r?\nmod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m
  const testBridgePattern =
    /#\[cfg\(test\)\]\s*\r?\n#\[path = "([^"]+)"\]\s*\r?\nmod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g
  const pathlessTestBridgePattern =
    /#\[cfg\(test\)\]\s*\r?\nmod\s+[A-Za-z_][A-Za-z0-9_]*\s*;/m
  const failures = []

  for (const file of rustFiles) {
    const source = await readFile(absolutePath(file), 'utf8')

    if (inlineTestModulePattern.test(source)) {
      failures.push(`${file}: move inline test module body under ${desktopRustUnitTests}`)
    }

    if (pathlessTestBridgePattern.test(source)) {
      failures.push(`${file}: test module bridge must use an explicit path under ${desktopRustUnitTests}`)
    }

    const sourceRelativeToRustSrc = path.relative(
      absolutePath(desktopRustSrc),
      absolutePath(file),
    )
    const parsedSourcePath = path.parse(sourceRelativeToRustSrc)

    for (const match of source.matchAll(testBridgePattern)) {
      const targetRelativeToSource = match[1]
      const testModuleName = match[2]
      const targetAbsolute = path.resolve(path.dirname(absolutePath(file)), targetRelativeToSource)
      const targetRelativeToRepo = path.relative(repoRoot, targetAbsolute).split(path.sep).join('/')
      const expectedTestFiles = expectedRustTestFiles(parsedSourcePath, testModuleName)

      if (!expectedTestFiles.includes(targetRelativeToRepo)) {
        failures.push(
          `${file}: test bridge points to ${targetRelativeToRepo}, expected ${expectedTestFiles.join(' or ')}`,
        )
        continue
      }

      if (!(await exists(targetRelativeToRepo))) {
        failures.push(`${file}: test bridge target ${targetRelativeToRepo} does not exist`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('desktop Rust unit test files are referenced by exactly one source bridge', async () => {
  const rustSourceFiles = await sourceFiles(desktopRustSrc, (fileName) => fileName.endsWith('.rs'))
  const rustUnitTestFiles = await sourceFiles(desktopRustUnitTests, (fileName) => fileName.endsWith('.rs'))
  const bridgePattern =
    /#\[cfg\(test\)\]\s*\r?\n#\[path = "([^"]+)"\]\s*\r?\nmod\s+[A-Za-z_][A-Za-z0-9_]*\s*;/g
  const bridgeTargets = new Map()
  const failures = []

  for (const file of rustSourceFiles) {
    const source = await readFile(absolutePath(file), 'utf8')

    for (const match of source.matchAll(bridgePattern)) {
      const targetAbsolute = path.resolve(path.dirname(absolutePath(file)), match[1])
      const targetRelativeToRepo = path.relative(repoRoot, targetAbsolute).split(path.sep).join('/')
      const existingRefs = bridgeTargets.get(targetRelativeToRepo) ?? []

      bridgeTargets.set(targetRelativeToRepo, [...existingRefs, file])
    }
  }

  for (const file of rustUnitTestFiles) {
    const refs = bridgeTargets.get(file) ?? []

    if (refs.length === 0) {
      failures.push(`${file}: Rust unit test file is not referenced by a source #[path] bridge`)
    } else if (refs.length > 1) {
      failures.push(`${file}: Rust unit test file is referenced by multiple source bridges: ${refs.join(', ')}`)
    }
  }

  for (const [target, refs] of bridgeTargets.entries()) {
    if (!target.startsWith(`${desktopRustUnitTests}/`)) {
      failures.push(`${refs.join(', ')}: Rust test bridge points outside ${desktopRustUnitTests}: ${target}`)
    } else if (!(await exists(target))) {
      failures.push(`${refs.join(', ')}: Rust test bridge target does not exist: ${target}`)
    }
  }

  assert.deepEqual(failures, [])
})

function expectedRustTestFiles(parsedSourcePath, testModuleName) {
  if (testModuleName === 'tests') {
    return [
      path
        .join(desktopRustUnitTests, parsedSourcePath.dir, `${parsedSourcePath.name}_tests.rs`)
        .split(path.sep)
        .join('/'),
    ]
  }

  const directNamedTest = path
    .join(desktopRustUnitTests, parsedSourcePath.dir, `${testModuleName}.rs`)
    .split(path.sep)
    .join('/')
  const nestedNamedTest = path
    .join(desktopRustUnitTests, parsedSourcePath.dir, parsedSourcePath.name, `${testModuleName}.rs`)
    .split(path.sep)
    .join('/')

  return [directNamedTest, nestedNamedTest]
}
