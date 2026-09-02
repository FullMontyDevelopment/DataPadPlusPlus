import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function sumMatches(text, pattern, indexes) {
  const totals = Object.fromEntries(Object.keys(indexes).map((key) => [key, 0]))
  let matched = false
  for (const match of text.matchAll(pattern)) {
    matched = true
    for (const [key, index] of Object.entries(indexes)) {
      totals[key] += Number(match[index] ?? 0)
    }
  }
  return matched ? totals : null
}

function rustFixtureSkipCount(directory) {
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      count += rustFixtureSkipCount(path)
    } else if (extname(entry.name) === '.rs') {
      const source = readFileSync(path, 'utf8')
      count += [...source.matchAll(/cfg_attr\(not\(feature = "live-fixtures"\), ignore = "requires live fixtures"\)/g)].length
    }
  }
  return count
}

export function summarizeTestLog(text, repoRoot = process.cwd()) {
  const rust = sumMatches(
    text,
    /test result: (?:ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored;/g,
    { passed: 1, failed: 2, ignored: 3 },
  ) ?? { passed: 0, failed: 0, ignored: 0 }
  const dotnet = sumMatches(
    text,
    /Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+),\s+Total:\s+(\d+)/g,
    { failed: 1, passed: 2, ignored: 3, total: 4 },
  ) ?? { failed: 0, passed: 0, ignored: 0, total: 0 }
  const node = sumMatches(
    text,
    /^[^\d\r\n]*tests\s+(\d+)\s*$[\s\S]*?^[^\d\r\n]*pass\s+(\d+)\s*$[\s\S]*?^[^\d\r\n]*fail\s+(\d+)\s*$[\s\S]*?^[^\d\r\n]*skipped\s+(\d+)\s*$/gm,
    { total: 1, passed: 2, failed: 3, ignored: 4 },
  ) ?? { total: 0, passed: 0, failed: 0, ignored: 0 }
  const vitest = { passed: 0, failed: 0, ignored: 0, total: 0 }
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*Tests\s+/.test(line)) continue
    for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) {
      const count = Number(match[1])
      if (match[2] === 'passed') vitest.passed += count
      if (match[2] === 'failed') vitest.failed += count
      if (match[2] === 'skipped' || match[2] === 'todo') vitest.ignored += count
      vitest.total += count
    }
  }
  const fixtureSkipped = rustFixtureSkipCount(resolve(repoRoot, 'apps/desktop/src-tauri/tests'))

  return {
    rust: { ...rust, executed: rust.passed + rust.failed },
    dotnet: { ...dotnet, executed: dotnet.passed + dotnet.failed },
    node: { ...node, executed: node.passed + node.failed },
    vitest: { ...vitest, executed: vitest.passed + vitest.failed },
    fixtureSkipped,
  }
}

export function renderTestSummary(summary, outcome = 'unknown') {
  const status = outcome === 'success' ? 'Passed' : outcome === 'failure' ? 'Failed' : outcome
  return [
    '## Deterministic test gate',
    '',
    `Overall status: **${status}**`,
    '',
    '| Runner | Executed | Passed | Ignored / skipped | Fixture-skipped | Failed |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    `| Rust | ${summary.rust.executed} | ${summary.rust.passed} | ${summary.rust.ignored} | ${summary.fixtureSkipped} | ${summary.rust.failed} |`,
    `| .NET sidecars | ${summary.dotnet.executed} | ${summary.dotnet.passed} | ${summary.dotnet.ignored} | 0 | ${summary.dotnet.failed} |`,
    `| Vitest | ${summary.vitest.executed} | ${summary.vitest.passed} | ${summary.vitest.ignored} | 0 | ${summary.vitest.failed} |`,
    `| Node test runner | ${summary.node.executed} | ${summary.node.passed} | ${summary.node.ignored} | 0 | ${summary.node.failed} |`,
    '',
    '> Fixture-skipped is the explicit live-fixture subset of the Rust ignored count.',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const logPath = resolve(process.argv[2] ?? '.test-results/ci-test.log')
  const summary = summarizeTestLog(existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')
  const markdown = renderTestSummary(summary, process.env.DATAPADPLUSPLUS_CI_OUTCOME)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    process.stdout.write(markdown)
  }
}
