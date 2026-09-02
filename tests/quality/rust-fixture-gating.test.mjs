import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const rustTestsRoot = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tests')
const fixtureGate = '#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]'

async function rustTestFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await rustTestFiles(entryPath))
    } else if (entry.name.endsWith('.rs')) {
      files.push(entryPath)
    }
  }
  return files
}

test('live Rust fixture tests are reported as ignored by deterministic runs', async () => {
  const failures = []
  let gatedTests = 0

  for (const file of await rustTestFiles(rustTestsRoot)) {
    const source = await readFile(file, 'utf8')
    const lines = source.split(/\r?\n/)
    gatedTests += lines.filter((line) => line.trim() === fixtureGate).length

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      const isDirectEnvironmentGate = line.includes('DATAPADPLUSPLUS_FIXTURE_RUN')
      const isSharedFixtureGate = /if\s+!fixtures_enabled\(\)/.test(line)
      if (!isDirectEnvironmentGate && !isSharedFixtureGate) continue

      let functionLine = lineIndex
      while (functionLine >= 0 && !/^\s*(?:async\s+)?fn\s+/.test(lines[functionLine])) {
        functionLine -= 1
      }
      if (functionLine < 0 || /fn\s+fixtures_enabled\s*\(/.test(lines[functionLine])) continue

      const attributes = lines.slice(Math.max(0, functionLine - 8), functionLine).map((value) => value.trim())
      if (!attributes.includes(fixtureGate)) {
        failures.push(`${path.relative(repoRoot, file)}:${functionLine + 1}`)
      }
    }
  }

  assert.ok(gatedTests >= 31, `expected at least 31 explicit live fixture tests, found ${gatedTests}`)
  assert.deepEqual(failures, [])
})
