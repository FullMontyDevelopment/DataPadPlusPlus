import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { litedbContext } from './litedb-sidecar-config.mjs'

const context = litedbContext()
const inputs = [...readdirSync(context.source).filter(name => /\.(cs|csproj)$/.test(name)).map(name => join(context.source, name)), import.meta.filename, join(import.meta.dirname, 'litedb-sidecar-config.mjs')]
const fresh = existsSync(context.destination) && inputs.every(path => statSync(path).mtimeMs <= statSync(context.destination).mtimeMs)
if (!process.argv.includes('--ensure') || !fresh) {
  mkdirSync(context.publish, { recursive: true })
  execFileSync(process.env.DATAPADPLUSPLUS_DOTNET || 'dotnet', ['publish', join(context.source, 'DataPadPlusPlus.LiteDbSidecar.csproj'),
    '--configuration', 'Release', '--runtime', context.rid, '--self-contained', 'true', '--output', context.publish,
    '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:PublishTrimmed=false', '-p:DebugType=None', '-p:DebugSymbols=false'],
    { cwd: context.root, stdio: 'inherit' })
  mkdirSync(dirname(context.destination), { recursive: true })
  copyFileSync(join(context.publish, `datapadplusplus-litedb-sidecar${context.target.extension}`), context.destination)
  if (context.target.extension === '') chmodSync(context.destination, 0o755)
}
console.log(`LiteDB runtime ready (${context.rid}).`)
