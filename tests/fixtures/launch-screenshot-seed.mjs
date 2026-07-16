import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const workspaceDir =
  process.env.DATAPADPLUSPLUS_SCREENSHOT_WORKSPACE_DIR ??
  join(fixtureDir, '.screenshot-workspace')
const resetWorkspace =
  !['0', 'false', 'no'].includes(
    String(process.env.DATAPADPLUSPLUS_SCREENSHOT_RESET_WORKSPACE ?? '1').toLowerCase(),
  )
const seedFixtures =
  !['0', 'false', 'no'].includes(
    String(process.env.DATAPADPLUSPLUS_SCREENSHOT_SEED_FIXTURES ?? '1').toLowerCase(),
  )

const env = Object.fromEntries(Object.entries({
  ...process.env,
  DATAPADPLUSPLUS_FIXTURE_RUN: '1',
  DATAPADPLUSPLUS_FIXTURE_PROFILE:
    process.env.DATAPADPLUSPLUS_FIXTURE_PROFILE ?? 'all',
  DATAPADPLUSPLUS_SCREENSHOT_SEED: '1',
  DATAPADPLUSPLUS_WORKSPACE_DIR: workspaceDir,
  DATAPADPLUSPLUS_SECRET_STORE:
    process.env.DATAPADPLUSPLUS_SECRET_STORE ?? 'file',
  DATAPADPLUSPLUS_SECRET_FILE:
    process.env.DATAPADPLUSPLUS_SECRET_FILE ?? join(workspaceDir, 'secrets.json'),
}).filter(([, value]) => value !== undefined))

if (seedFixtures) {
  console.log(`Seeding running fixture profile(s): ${env.DATAPADPLUSPLUS_FIXTURE_PROFILE}`)
  const seedResult = spawnSync(
    process.execPath,
    [join(fixtureDir, 'seed.mjs'), env.DATAPADPLUSPLUS_FIXTURE_PROFILE],
    {
      env,
      stdio: 'inherit',
      shell: false,
    },
  )

  if (seedResult.error) {
    throw seedResult.error
  }
  if (seedResult.status !== 0) {
    throw new Error(`Fixture seeding failed with exit code ${seedResult.status}.`)
  }
}

if (resetWorkspace) {
  rmSync(workspaceDir, { recursive: true, force: true })
}
mkdirSync(workspaceDir, { recursive: true })

console.log(`Launching DataPad++ with screenshot workspace: ${workspaceDir}`)
if (resetWorkspace) {
  console.log('Reset screenshot workspace before launch.')
}

const isWindows = process.platform === 'win32'
const command = isWindows ? 'cmd.exe' : 'npm'
const args = isWindows
  ? ['/d', '/s', '/c', 'npm run tauri:dev --workspace @datapadplusplus/desktop']
  : ['run', 'tauri:dev', '--workspace', '@datapadplusplus/desktop']

const child = spawn(command, args, {
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
