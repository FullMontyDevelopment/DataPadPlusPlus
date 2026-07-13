import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const project = join(root, 'apps', 'desktop', 'src-tauri', 'sidecars', 'oracle', 'DataPadPlusPlus.OracleSidecar.csproj')
const binaries = join(root, 'apps', 'desktop', 'src-tauri', 'binaries')
const licenseDestination = join(
  root,
  'apps',
  'desktop',
  'src-tauri',
  'resources',
  'licenses',
  'Oracle.ManagedDataAccess.Core-LICENSE.txt',
)

const targets = {
  'win32-x64': { rid: 'win-x64', triple: 'x86_64-pc-windows-msvc', extension: '.exe' },
  'linux-x64': { rid: 'linux-x64', triple: 'x86_64-unknown-linux-gnu', extension: '' },
  'darwin-arm64': { rid: 'osx-arm64', triple: 'aarch64-apple-darwin', extension: '' },
}

const key = `${process.platform}-${process.arch}`
const target = targets[key]
if (!target) {
  throw new Error(`Oracle sidecar publishing is not configured for ${key}.`)
}

const publishDir = join(root, 'apps', 'desktop', 'src-tauri', 'sidecars', 'oracle', 'publish', target.rid)
rmSync(publishDir, { recursive: true, force: true })
mkdirSync(publishDir, { recursive: true })
mkdirSync(binaries, { recursive: true })

execFileSync('dotnet', [
  'publish',
  project,
  '--configuration', 'Release',
  '--runtime', target.rid,
  '--self-contained', 'true',
  '--output', publishDir,
  '-p:PublishSingleFile=true',
  '-p:PublishTrimmed=false',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
], { cwd: root, stdio: 'inherit' })

const source = join(publishDir, `datapadplusplus-oracle-sidecar${target.extension}`)
const destination = join(binaries, `datapadplusplus-oracle-runtime-${target.triple}${target.extension}`)
copyFileSync(source, destination)
const nugetRoot = process.env.NUGET_PACKAGES || join(homedir(), '.nuget', 'packages')
const licenseSource = join(
  nugetRoot,
  'oracle.manageddataaccess.core',
  '23.26.200',
  'LICENSE.txt',
)
if (!existsSync(licenseSource)) {
  throw new Error(`Oracle.ManagedDataAccess.Core license was not restored at ${licenseSource}.`)
}
mkdirSync(dirname(licenseDestination), { recursive: true })
copyFileSync(licenseSource, licenseDestination)
console.log(`Prepared Oracle sidecar: ${destination}`)
console.log(`Prepared Oracle runtime license: ${licenseDestination}`)
