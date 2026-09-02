import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message)
  }
}

export function validateLiveFixturesWorkflow(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, '.github/workflows/live-fixtures.yml')
  const text = readFileSync(path, 'utf8')

  requireMatch(text, /^\s*pull_request:\s*$/m, 'Live fixtures must run when adapter or fixture code changes')
  requireMatch(text, /^\s*schedule:\s*$/m, 'Live fixtures must have a scheduled execution')
  requireMatch(text, /^\s*workflow_dispatch:\s*$/m, 'Live fixtures must support manual profile selection')
  requireMatch(text, /^\s*contents:\s*read\s*$/m, 'Live fixtures must use read-only repository permissions')
  requireMatch(text, /^\s*core-fixtures:\s*$/m, 'Live fixtures must define a core reference-engine job')
  requireMatch(text, /DATAPADPLUSPLUS_FIXTURE_PROFILE:\s*core/, 'The core fixture job must select the core profile')
  requireMatch(text, /npm run fixtures:validate:postgres/, 'The core fixture job must validate PostgreSQL')
  requireMatch(text, /npm run fixtures:validate:mongodb/, 'The core fixture job must validate MongoDB')
  requireMatch(text, /npm run fixtures:validate:redis/, 'The core fixture job must validate Redis')
  requireMatch(text, /npm run rust:test:fixtures/, 'The core fixture job must execute live Rust adapter tests')
  requireMatch(text, /npm run e2e:desktop:build/, 'The core fixture job must build the native desktop test binary')
  requireMatch(text, /xvfb-run -a npm run e2e:desktop/, 'The core fixture job must execute native desktop fixture journeys')
  requireMatch(text, /^\s*oracle-fixture:\s*$/m, 'Live fixtures must define an Oracle continuation job')
  requireMatch(text, /npm run fixtures:test:oracle/, 'The Oracle job must validate paging and completion')

  const cleanupSteps = [...text.matchAll(/- name: Stop [^\n]+\n\s+if: always\(\)/g)]
  if (cleanupSteps.length < 2) {
    throw new Error('Every live fixture job must retain an unconditional cleanup step')
  }

  return { path }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = validateLiveFixturesWorkflow(process.cwd())
    console.log(`Live fixture workflow OK: ${result.path}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
