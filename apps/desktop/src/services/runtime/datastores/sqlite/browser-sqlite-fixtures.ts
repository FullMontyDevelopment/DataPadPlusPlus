export function sqliteAttachedDatabases() {
  return [
    { seq: 0, name: 'main', file: 'datapadplusplus.sqlite', status: 'open' },
  ]
}

export function sqlitePragmaRows() {
  return [
    { name: 'foreign_keys', value: 'ON', status: 'enabled', detail: 'Foreign-key enforcement is enabled.' },
    { name: 'journal_mode', value: 'wal', status: 'configured', detail: 'Write-ahead logging mode.' },
    { name: 'synchronous', value: 'normal', status: 'configured', detail: 'Balanced durability and performance.' },
    { name: 'quick_check', value: 'ok', status: 'ok', detail: 'No corruption was reported by the preview check.' },
  ]
}

export function sqliteSchemaRows() {
  return [
    {
      type: 'table',
      name: 'accounts',
      tableName: 'accounts',
      definition: 'create table accounts (id integer primary key, name text, updated_at text not null default current_timestamp)',
    },
    {
      type: 'view',
      name: 'active_accounts',
      tableName: 'active_accounts',
      definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
    },
  ]
}
