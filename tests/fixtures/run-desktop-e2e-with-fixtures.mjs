import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(args, options = {}) {
  const result = spawnSync(npm, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATAPADPLUSPLUS_FIXTURE_RUN: process.env.DATAPADPLUSPLUS_FIXTURE_RUN ?? '1',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

let failed = false

try {
  run(['run', 'fixtures:up'])
  run(['run', 'fixtures:seed'])
  run(['run', 'e2e:desktop:build'])
  run(['run', 'e2e:desktop'])
} catch (error) {
  failed = true
  console.error(error instanceof Error ? error.message : error)
} finally {
  try {
    run(['run', 'fixtures:down'])
  } catch (error) {
    failed = true
    console.error(error instanceof Error ? error.message : error)
  }
}

if (failed) {
  process.exit(1)
}
