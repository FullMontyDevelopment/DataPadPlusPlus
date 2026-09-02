import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTestSummary, summarizeTestLog } from './write-test-summary.mjs'

test('test summary separates executed, ignored, fixture-skipped, and failed counts', () => {
  const summary = summarizeTestLog([
    'test result: ok. 100 passed; 2 failed; 7 ignored; 0 measured; 0 filtered out',
    'Passed!  - Failed:     1, Passed:    26, Skipped:     3, Total:    30',
    'ℹ tests 10',
    'ℹ pass 8',
    'ℹ fail 1',
    'ℹ skipped 1',
    ' Test Files  2 passed (2)',
    '      Tests  25 passed | 2 skipped (27)',
  ].join('\n'), process.cwd())

  assert.deepEqual(summary.rust, { passed: 100, failed: 2, ignored: 7, executed: 102 })
  assert.deepEqual(summary.dotnet, { failed: 1, passed: 26, ignored: 3, total: 30, executed: 27 })
  assert.deepEqual(summary.node, { total: 10, passed: 8, failed: 1, ignored: 1, executed: 9 })
  assert.deepEqual(summary.vitest, { passed: 25, failed: 0, ignored: 2, total: 27, executed: 25 })
  assert.ok(summary.fixtureSkipped > 0)

  const markdown = renderTestSummary(summary, 'failure')
  assert.match(markdown, /Overall status: \*\*Failed\*\*/)
  assert.match(markdown, /\| Rust \| 102 \| 100 \| 7 \|/)
})
