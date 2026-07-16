import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const oracleSidecarTargets = {
  'win-x64': { triple: 'x86_64-pc-windows-msvc', extension: '.exe' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', extension: '' },
  'osx-arm64': { triple: 'aarch64-apple-darwin', extension: '' },
}

const hostTargets = {
  'win32-x64': 'win-x64',
  'linux-x64': 'linux-x64',
  'darwin-arm64': 'osx-arm64',
}

export function resolveOracleSidecarContext({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const root = resolve(env.DATAPADPLUSPLUS_ORACLE_ROOT || defaultRoot)
  const hostKey = `${platform}-${arch}`
  const rid = env.DATAPADPLUSPLUS_ORACLE_RID || hostTargets[hostKey]
  const target = oracleSidecarTargets[rid]
  if (!target) {
    const requested = rid ? `runtime ${rid}` : `host ${hostKey}`
    throw new Error(`Oracle sidecar publishing is not configured for ${requested}.`)
  }

  const sidecarRoot = join(root, 'apps', 'desktop', 'src-tauri', 'sidecars', 'oracle')
  const binaries = join(root, 'apps', 'desktop', 'src-tauri', 'binaries')
  const publishDir = join(sidecarRoot, 'publish', rid)
  const licenseDestination = join(
    root,
    'apps',
    'desktop',
    'src-tauri',
    'resources',
    'licenses',
    'Oracle.ManagedDataAccess.Core-LICENSE.txt',
  )

  return {
    root,
    rid,
    target,
    sidecarRoot,
    project: join(sidecarRoot, 'DataPadPlusPlus.OracleSidecar.csproj'),
    binaries,
    publishDir,
    publishedExecutable: join(
      publishDir,
      `datapadplusplus-oracle-sidecar${target.extension}`,
    ),
    destination: join(
      binaries,
      `datapadplusplus-oracle-runtime-${target.triple}${target.extension}`,
    ),
    licenseDestination,
    licenseSource: join(
      env.NUGET_PACKAGES || join(homedir(), '.nuget', 'packages'),
      'oracle.manageddataaccess.core',
      '23.26.200',
      'LICENSE.txt',
    ),
    prepareScript: join(root, 'tests', 'release', 'prepare-oracle-sidecar.mjs'),
    configScript: fileURLToPath(import.meta.url),
    lockDir: join(sidecarRoot, 'publish', `.ensure-${rid}.lock`),
  }
}

export function oracleSidecarSourceFiles(context) {
  const files = collectFiles(context.sidecarRoot).filter((file) =>
    ['.cs', '.csproj', '.props', '.targets'].some((extension) => file.endsWith(extension)),
  )
  files.push(context.prepareScript, context.configScript)
  return files.filter(existsSync)
}

export function oracleSidecarNeedsBuild(context) {
  if (!existsSync(context.destination) || !existsSync(context.licenseDestination)) {
    return true
  }

  const outputTime = statSync(context.destination).mtimeMs
  return oracleSidecarSourceFiles(context).some((file) => statSync(file).mtimeMs > outputTime)
}

function collectFiles(root) {
  if (!existsSync(root)) {
    return []
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'bin' || entry.name === 'obj' || entry.name === 'publish'
        ? []
        : collectFiles(path)
    }
    return [path]
  })
}
