export function mysqlTables(database: string) {
  return [
    { schema: database, name: 'accounts', type: 'BASE TABLE', rows: 128, size: '80 KB', owner: 'app' },
    { schema: database, name: 'orders', type: 'BASE TABLE', rows: 256, size: '144 KB', owner: 'app' },
    { schema: database, name: 'products', type: 'BASE TABLE', rows: 44, size: '64 KB', owner: 'app' },
  ]
}

export function mysqlIndexes(table: string) {
  return [
    { name: 'PRIMARY', type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB', usage: table },
    ...(table === 'orders'
      ? [{ name: 'orders_account_id_idx', type: 'btree', columns: 'account_id', unique: false, valid: true, size: '24 KB', usage: 'foreign key lookup' }]
      : []),
  ]
}

export function mysqlStatistics(database: string) {
  return mysqlTables(database).map((table) => ({
    name: table.name,
    rows: table.rows,
    scans: 0,
    size: table.size,
  }))
}

export function mysqlGrants(database: string) {
  return [
    { principal: 'app@%', privilege: 'SELECT, INSERT, UPDATE, DELETE', object: database, state: 'granted', grantor: 'root@%' },
    { principal: 'reporting@%', privilege: 'SELECT', object: 'accounts', state: 'granted', grantor: 'root@%' },
  ]
}
