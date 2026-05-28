export function parseMysqlObjectScope(scope: string, fallbackDatabase: string) {
  const parts = scope.split(':')
  if (parts.length >= 3) {
    return {
      database: parts[1] || fallbackDatabase,
      objectName: parts[2] || 'accounts',
    }
  }

  const [, qualified = ''] = scope.split(':')
  const [database, objectName] = qualified.includes('.')
    ? qualified.split('.', 2)
    : [fallbackDatabase, qualified]
  return {
    database: database || fallbackDatabase,
    objectName: objectName || 'accounts',
  }
}

export function mysqlInformationSchemaView(section: string) {
  switch (section) {
    case 'indexes':
      return 'statistics'
    case 'constraints':
    case 'foreign-keys':
      return 'table_constraints'
    case 'triggers':
      return 'triggers'
    default:
      return 'columns'
  }
}

export function mysqlQualifiedName(database: string, objectName: string) {
  return `${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`
}

export function mysqlIdentifier(value: string) {
  return `\`${value.replace(/`/g, '``')}\``
}
