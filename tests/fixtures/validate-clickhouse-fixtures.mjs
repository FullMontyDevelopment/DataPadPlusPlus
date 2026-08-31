import { spawnSync } from 'node:child_process'

const container = 'datapadplusplus-clickhouse'
const archive = 'datapad-fixture-native-backup.zip'
const tests = [
  'clickhouse_native_transfer_roundtrips_all_formats',
  'clickhouse_native_database_backup_restore_roundtrips',
]

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
    stdio: options.stdio ?? 'pipe',
  })
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

const running = run('docker', ['inspect', '-f', '{{.State.Running}}', container])
if (running.status !== 0 || running.stdout.trim() !== 'true') {
  console.error(`ClickHouse fixture ${container} is not running. Start the analytics fixture profile first.`)
  process.exit(1)
}

function removeFixtureArchives() {
  return run('docker', [
    'exec',
    container,
    'sh',
    '-lc',
    `rm -f -- /var/lib/clickhouse/backups/${archive} /var/lib/clickhouse/backups/dpp-test.zip`,
  ])
}

const initialCleanup = removeFixtureArchives()
if (initialCleanup.status !== 0) {
  console.error(output(initialCleanup))
  process.exit(1)
}

let failed = false
try {
  for (const test of tests) {
    const result = run(
      'cargo',
      ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--test', 'adapters_integration', test, '--', '--nocapture'],
      {
        env: {
          ...process.env,
          DATAPADPLUSPLUS_FIXTURE_RUN: '1',
          DATAPADPLUSPLUS_FIXTURE_PROFILE: 'analytics',
          DATAPADPLUSPLUS_CLICKHOUSE_BACKUP_ARCHIVE: archive,
        },
      },
    )
    process.stdout.write(output(result))
    if (result.status !== 0) {
      failed = true
      break
    }
  }
} finally {
  const cleanup = removeFixtureArchives()
  if (cleanup.status !== 0) {
    process.stderr.write(output(cleanup))
    failed = true
  }
}

if (failed) {
  process.exitCode = 1
} else {
  console.log('ok - ClickHouse: CSV, TSV, JSONEachRow, and Parquet table transfer plus native server archive backup, isolated restore, type fidelity, conflict rejection, and cleanup')
}
