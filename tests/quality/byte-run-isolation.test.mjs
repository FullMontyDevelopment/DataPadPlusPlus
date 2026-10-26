import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../apps/desktop/src/app/components/workbench/results/empty-state')

test('Byte Run stays dependency-light and cannot import workbench state or runtime services', () => {
  for (const name of readdirSync(resolve(root, 'byte-run')).filter(name => /\.tsx?$/.test(name))) {
    const source = readFileSync(resolve(root, 'byte-run', name), 'utf8')
    for (const [, dependency] of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(dependency === 'react' || dependency === 'lucide-react' ||
        (dependency.startsWith('./') && !dependency.slice(2).includes('/')),
      `${name} must not import an application service: ${dependency}`)
    }
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|Worker|Audio)\b/, name)
    assert.doesNotMatch(source, /\b(?:setInterval|setTimeout)\s*\(/, name)
  }
})

test('the results empty state loads the game only through a lazy boundary and keeps CSS scoped', () => {
  const source = readFileSync(resolve(root, 'ResultsEmptyState.tsx'), 'utf8')
  assert.match(source, /lazy\(\(\) => import\('\.\/byte-run\/ByteRun'\)\)/)
  assert.doesNotMatch(source, /from ['"].*byte-run/)
  const gameCss = readFileSync(resolve(root, 'byte-run/byte-run.css'), 'utf8')
  for (const match of gameCss.matchAll(/(?:^|\})\s*([^{}]+)\{/g)) {
    for (const selector of match[1].trim().split(',')) assert.match(selector.trim(), /^\.byte-run/)
  }
})
