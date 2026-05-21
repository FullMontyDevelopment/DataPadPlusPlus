import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const forbiddenSinks = [
  ['dangerouslySetInnerHTML', /\bdangerouslySetInnerHTML\b/],
  ['innerHTML assignment', /\.innerHTML\s*=/],
  ['eval', /\beval\s*\(/],
  ['dynamic Function', /\bnew\s+Function\s*\(/],
]

test('production frontend code avoids dangerous rendering and code execution sinks', async () => {
  const files = await sourceFiles('apps/desktop/src', ['.ts', '.tsx'])
  const failures = []

  for (const file of files) {
    const normalized = normalizePath(path.relative(repoRoot, file))
    if (normalized.includes('.test.') || normalized.endsWith('/test/setup.ts')) {
      continue
    }

    const contents = await readFile(file, 'utf8')
    for (const [label, pattern] of forbiddenSinks) {
      if (pattern.test(contents)) {
        failures.push(`${normalized}: contains ${label}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

async function sourceFiles(root, extensions) {
  const rootPath = path.join(repoRoot, root)
  const entries = await readdir(rootPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name)

      if (entry.isDirectory()) {
        return sourceFiles(path.relative(repoRoot, fullPath), extensions)
      }

      return extensions.includes(path.extname(entry.name)) ? [fullPath] : []
    }),
  )

  return files.flat()
}

function normalizePath(file) {
  return file.split(path.sep).join('/')
}
