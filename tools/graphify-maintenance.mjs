import { spawn } from 'node:child_process'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDirectory, '..')
export const graphifyOutputDirectory = path.join(repositoryRoot, 'graphify-out')

const noBackupComment =
  '# Repository policy: graphify-out is regenerable; do not create dated snapshots.'
const noBackupExport = 'export GRAPHIFY_NO_BACKUP=1'
const hookMarkers = [
  {
    fileName: 'post-commit',
    start: '# graphify-hook-start',
    end: '# graphify-hook-end',
  },
  {
    fileName: 'post-checkout',
    start: '# graphify-checkout-hook-start',
    end: '# graphify-checkout-hook-end',
  },
]

function isValidDatedBackupName(name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
    return false
  }

  const parsed = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === name
}

export async function pruneGraphifyBackups(outputDirectory = graphifyOutputDirectory) {
  const resolvedOutput = path.resolve(outputDirectory)
  let entries

  try {
    entries = await readdir(resolvedOutput, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const removed = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidDatedBackupName(entry.name)) {
      continue
    }

    const candidate = path.resolve(resolvedOutput, entry.name)
    const relative = path.relative(resolvedOutput, candidate)
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative.startsWith(`..${path.sep}`) ||
      path.dirname(candidate) !== resolvedOutput
    ) {
      throw new Error(`Refusing to remove Graphify path outside ${resolvedOutput}: ${candidate}`)
    }

    await rm(candidate, { recursive: true, force: true })
    removed.push(entry.name)
  }

  return removed.sort()
}

export function addNoBackupPolicy(content, { start, end }) {
  const startIndex = content.indexOf(start)
  const endIndex = content.indexOf(end, startIndex + start.length)

  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Graphify hook markers are missing: ${start} ... ${end}`)
  }

  const block = content.slice(startIndex, endIndex)
  if (block.split(/\r?\n/).some((line) => line.trim() === noBackupExport)) {
    return content
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const insertionIndex = startIndex + start.length
  const policy = `${newline}${noBackupComment}${newline}${noBackupExport}`

  return `${content.slice(0, insertionIndex)}${policy}${content.slice(insertionIndex)}`
}

export async function patchGraphifyHookFile(hookPath, markers) {
  const before = await readFile(hookPath, 'utf8')
  const after = addNoBackupPolicy(before, markers)

  if (after !== before) {
    await writeFile(hookPath, after, 'utf8')
    return true
  }

  return false
}

async function run(command, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''

    if (capture) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}${stderr ? `\n${stderr}` : ''}`))
      }
    })
  })
}

async function resolveGitHooksDirectory() {
  const { stdout } = await run('git', ['rev-parse', '--git-path', 'hooks'], { capture: true })
  const reportedPath = stdout.trim()

  if (!reportedPath) {
    throw new Error('Git did not report a hooks directory')
  }

  return path.resolve(repositoryRoot, reportedPath)
}

async function patchInstalledHooks() {
  const hooksDirectory = await resolveGitHooksDirectory()
  const patched = []

  for (const markers of hookMarkers) {
    const hookPath = path.join(hooksDirectory, markers.fileName)
    if (await patchGraphifyHookFile(hookPath, markers)) {
      patched.push(markers.fileName)
    }
  }

  return patched
}

async function setup() {
  await run('graphify', ['hook', 'install'])
  const patched = await patchInstalledHooks()
  const removed = await pruneGraphifyBackups()
  console.log(`Graphify hooks configured with backups disabled${patched.length ? `: ${patched.join(', ')}` : ''}.`)
  console.log(`Removed ${removed.length} dated Graphify backup director${removed.length === 1 ? 'y' : 'ies'}.`)
}

async function refresh() {
  await run('graphify', ['update', '.'], {
    env: { ...process.env, GRAPHIFY_NO_BACKUP: '1' },
  })
  const removed = await pruneGraphifyBackups()
  console.log(`Graphify refresh complete; removed ${removed.length} dated backup director${removed.length === 1 ? 'y' : 'ies'}.`)
}

async function prune() {
  const removed = await pruneGraphifyBackups()
  console.log(`Removed ${removed.length} dated Graphify backup director${removed.length === 1 ? 'y' : 'ies'}.`)
}

async function status() {
  await run('graphify', ['hook', 'status'])
  const hooksDirectory = await resolveGitHooksDirectory()

  for (const markers of hookMarkers) {
    const content = await readFile(path.join(hooksDirectory, markers.fileName), 'utf8')
    const blockStart = content.indexOf(markers.start)
    const blockEnd = content.indexOf(markers.end, blockStart + markers.start.length)
    const block = blockStart >= 0 && blockEnd >= 0 ? content.slice(blockStart, blockEnd) : ''
    const configured = block.split(/\r?\n/).some((line) => line.trim() === noBackupExport)
    console.log(`${markers.fileName} backups: ${configured ? 'disabled' : 'not disabled'}`)
  }
}

async function main() {
  const command = process.argv[2]

  if (command === 'setup') {
    await setup()
  } else if (command === 'refresh') {
    await refresh()
  } else if (command === 'prune') {
    await prune()
  } else if (command === 'status') {
    await status()
  } else {
    throw new Error('Usage: node tools/graphify-maintenance.mjs <setup|refresh|prune|status>')
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
