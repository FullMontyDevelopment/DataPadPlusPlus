export function parseMysqlObjectScope(scope: string, fallbackDatabase: string) {
  const normalizedFallback = fallbackDatabase.trim()
  const parts = scope.split(':')
  if (parts.length >= 3) {
    return {
      database: parts[1] || normalizedFallback,
      objectName: parts[2] || '',
    }
  }

  const [, qualified = ''] = scope.split(':')
  const [database, objectName] = qualified.includes('.')
    ? qualified.split('.', 2)
    : [fallbackDatabase, qualified]
  return {
    database: database || normalizedFallback,
    objectName: objectName || '',
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
