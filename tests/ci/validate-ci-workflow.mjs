import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN_PATTERNS = [
  [/docker\s+compose|docker\s+exec|docker\s+run/, 'CI must not start Docker fixtures'],
  [/fixtures:(up|seed|down|up:all|seed:all|up:profile)/, 'CI must not run fixture scripts'],
  [/check:e2e|e2e:desktop|tauri-driver|webdriverio/i, 'CI must not run desktop E2E'],
  [/DATAPADPLUSPLUS_FIXTURE_RUN:\s*['"]1['"]/, 'CI must not enable fixture-backed tests'],
  [/npm\s+run\s+tauri:build|tauri\s+build/, 'CI must not build release desktop bundles'],
]

const NATIVE_SMOKE_FORBIDDEN_PATTERNS = [
  [/docker\s+compose|docker\s+exec|docker\s+run/, 'Native smoke CI must not start Docker fixtures'],
  [/DATAPADPLUSPLUS_FIXTURE_PROFILE:\s*['"]?(?!sqlite-smoke)[^\s'"]+/, 'Native smoke CI must use only the SQLite fixture profile'],
]

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message)
  }
}

function workflowJob(text, jobId) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `  ${jobId}:`)
  if (start === -1) {
    throw new Error(`ci.yml must define the ${jobId} job`)
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index
      break
    }
  }

  return lines.slice(start, end).join('\n')
}

export function validateCiWorkflow(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, '.github/workflows/ci.yml')
  const text = readFileSync(path, 'utf8')
  const deterministicJob = workflowJob(text, 'deterministic-tests')
  const nativeSmokeJob = workflowJob(text, 'native-smoke')

  requireMatch(text, /^on:\s*$/m, 'ci.yml must define workflow triggers')
  requireMatch(text, /^\s*pull_request:\s*$/m, 'ci.yml must run on pull requests')
  requireMatch(text, /^\s*push:\s*$/m, 'ci.yml must run on pushes')
  requireMatch(text, /^\s*workflow_dispatch:\s*$/m, 'ci.yml must support manual runs')
  requireMatch(text, /^\s*contents:\s*read\s*$/m, 'ci.yml must use read-only contents permissions')
  requireMatch(
    deterministicJob,
    /Unit and dependency-free integration tests/,
    'ci.yml should describe its dependency-free CI scope',
  )
  requireMatch(deterministicJob, /DATAPADPLUSPLUS_FIXTURE_RUN:\s*['"]0['"]/, 'ci.yml must explicitly disable fixtures')
  requireMatch(deterministicJob, /npm\s+run\s+ci:test/, 'ci.yml must run the shared deterministic CI script')
  requireMatch(
    deterministicJob,
    /write-test-summary\.mjs/,
    'ci.yml must publish the deterministic test summary',
  )

  for (const [pattern, message] of FORBIDDEN_PATTERNS) {
    if (pattern.test(deterministicJob)) {
      throw new Error(message)
    }
  }

  requireMatch(nativeSmokeJob, /runs-on:\s*windows-latest/, 'Native smoke CI must run on a Windows GitHub-hosted runner')
  requireMatch(nativeSmokeJob, /DATAPADPLUSPLUS_FIXTURE_PROFILE:\s*sqlite-smoke/, 'Native smoke CI must select only SQLite')
  requireMatch(nativeSmokeJob, /npm\s+run\s+e2e:desktop:build/, 'Native smoke CI must build the production-mode process with its test-only embedded WebDriver provider')
  requireMatch(nativeSmokeJob, /npm\s+run\s+e2e:desktop:smoke/, 'Native smoke CI must run the SQLite desktop E2E suite')

  for (const [pattern, message] of NATIVE_SMOKE_FORBIDDEN_PATTERNS) {
    if (pattern.test(nativeSmokeJob)) {
      throw new Error(message)
    }
  }

  return { path }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = validateCiWorkflow(process.cwd())
    console.log(`CI workflow OK: ${result.path}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
