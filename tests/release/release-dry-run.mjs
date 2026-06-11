import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateReleaseVersion } from './validate-release-version.mjs'
import { validateReleaseWorkflow } from './validate-release-workflow.mjs'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

export function runReleaseDryRun(version, repoRoot = process.cwd()) {
  const result = validateReleaseVersion(version, repoRoot)
  validateReleaseWorkflow(repoRoot)

  console.log(`Release dry-run validation OK for ${result.tagName}`)
  run('npm', ['run', 'check:all'])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runReleaseDryRun(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
