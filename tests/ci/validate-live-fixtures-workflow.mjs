import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message)
  }
}

const JOB_LEVEL_RUNNER_CONTEXT = /^ {6}[A-Za-z_][A-Za-z0-9_]*:\s*.*\$\{\{\s*runner\./m

export function validateLiveFixturesWorkflow(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, '.github/workflows/live-fixtures.yml')
  const text = readFileSync(path, 'utf8')

  requireMatch(text, /^\s*pull_request:\s*$/m, 'Live fixtures must run when adapter or fixture code changes')
  if (/^\s*schedule\s*:/m.test(text) || /github\.event\.schedule/.test(text)) {
    throw new Error('Live fixtures must not run on a schedule or retain schedule-only job conditions')
  }
  requireMatch(text, /^\s*workflow_dispatch:\s*$/m, 'Live fixtures must support manual profile selection')
  requireMatch(text, /^\s*contents:\s*read\s*$/m, 'Live fixtures must use read-only repository permissions')
  requireMatch(text, /^\s*core-fixtures:\s*$/m, 'Live fixtures must define a core reference-engine job')
  requireMatch(text, /DATAPADPLUSPLUS_FIXTURE_PROFILE:\s*core/, 'The core fixture job must select the core profile')
  requireMatch(text, /npm run fixtures:validate:postgres/, 'The core fixture job must validate PostgreSQL')
  requireMatch(text, /npm run fixtures:validate:mongodb/, 'The core fixture job must validate MongoDB')
  requireMatch(text, /npm run fixtures:validate:redis/, 'The core fixture job must validate Redis')
  requireMatch(text, /npm run rust:test:fixtures/, 'The core fixture job must execute live Rust adapter tests')
  requireMatch(text, /npm run e2e:desktop:build/, 'The core fixture job must build the native desktop test binary')
  requireMatch(text, /xvfb-run -a (?:bash apps\/desktop\/e2e\/with-linux-keyring\.sh )?npm run e2e:desktop/, 'The core fixture job must execute native desktop fixture journeys')
  requireMatch(text, /^\s*oracle-fixture:\s*$/m, 'Live fixtures must define an Oracle continuation job')
  requireMatch(text, /npm run fixtures:test:oracle/, 'The Oracle job must validate paging and completion')

  if (JOB_LEVEL_RUNNER_CONTEXT.test(text)) {
    throw new Error('Live fixture jobs must use the runner context only after a runner starts, such as in step-level env')
  }

  const cleanupSteps = [...text.matchAll(/- name: Stop [^\n]+\n\s+if: always\(\)/g)]
  if (cleanupSteps.length < 2) {
    throw new Error('Every live fixture job must retain an unconditional cleanup step')
  }

  const coreJob = text.split('  core-fixtures:')[1]?.split('\n  oracle-fixture:')[0] ?? ''
  const dotnet = coreJob.indexOf('uses: actions/setup-dotnet@')
  const prepare = coreJob.indexOf('npm run oracle:sidecar:ensure')
  const tests = coreJob.indexOf('npm run rust:test:fixtures:core')
  const build = coreJob.indexOf('npm run e2e:desktop:build')
  if (dotnet < 0 || prepare < dotnet || tests < prepare || build < tests) {
    throw new Error('Core fixtures must install .NET, prepare the bundled Oracle runtime, run core Rust tests, then build the desktop')
  }
  requireMatch(coreJob, /libxdo-dev/, 'Core fixtures must install the Linux desktop linker dependencies')
  for (const dependency of ['dbus-x11', 'gnome-keyring', 'libsecret-tools']) {
    requireMatch(coreJob, new RegExp(`\\b${dependency}\\b`), 'Core fixtures must install the isolated Linux credential store dependencies')
  }
  const desktopRuns = coreJob.split('\n').filter((line) => /npm run e2e:desktop(?::mcp)?(?:\s|$)/.test(line))
  if (desktopRuns.length === 0 || desktopRuns.some((line) => !line.includes('dbus-run-session -- xvfb-run -a bash apps/desktop/e2e/with-linux-keyring.sh'))) {
    throw new Error('Core fixtures must execute desktop journeys inside an isolated D-Bus and keyring session')
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
