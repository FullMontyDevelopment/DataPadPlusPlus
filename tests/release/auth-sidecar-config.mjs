import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const authTargets = {
  'win-x64': { triple: 'x86_64-pc-windows-msvc', extension: '.exe' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', extension: '' },
  'osx-arm64': { triple: 'aarch64-apple-darwin', extension: '' },
}
export function authContext(env = process.env) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const rid = env.DATAPADPLUSPLUS_AUTH_RID || ({ 'win32-x64': 'win-x64', 'linux-x64': 'linux-x64', 'darwin-arm64': 'osx-arm64' })[`${process.platform}-${process.arch}`]
  const target = authTargets[rid]
  if (!target) throw new Error('Unsupported authentication helper target.')
  const source = join(root, 'apps/desktop/src-tauri/sidecars/auth')
  return { root, rid, target, source, publish: join(source, 'publish', rid),
    destination: join(root, 'apps/desktop/src-tauri/binaries', `datapadplusplus-auth-runtime-${target.triple}${target.extension}`) }
}
