import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

import { resolveOracleSidecarContext } from './oracle-sidecar-config.mjs'

const context = resolveOracleSidecarContext()
rmSync(context.publishDir, { recursive: true, force: true })
mkdirSync(context.publishDir, { recursive: true })
mkdirSync(context.binaries, { recursive: true })

try {
  execFileSync(process.env.DATAPADPLUSPLUS_DOTNET || 'dotnet', [
  'publish',
  context.project,
  '--configuration', 'Release',
  '--runtime', context.rid,
  '--self-contained', 'true',
  '--output', context.publishDir,
  '-p:PublishSingleFile=true',
  '-p:PublishTrimmed=false',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
  ], { cwd: context.root, stdio: 'inherit' })
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error(
      'Oracle sidecar preparation requires the .NET 8 SDK. Install it and make dotnet available on PATH.',
    )
  }
  throw error
}

copyFileSync(context.publishedExecutable, context.destination)
if (context.target.extension === '') {
  chmodSync(context.destination, 0o755)
}
if (!existsSync(context.licenseSource)) {
  throw new Error(`Oracle.ManagedDataAccess.Core license was not restored at ${context.licenseSource}.`)
}
mkdirSync(dirname(context.licenseDestination), { recursive: true })
copyFileSync(context.licenseSource, context.licenseDestination)
console.log(`Prepared Oracle sidecar (${context.rid}): ${context.destination}`)
console.log(`Prepared Oracle runtime license: ${context.licenseDestination}`)
