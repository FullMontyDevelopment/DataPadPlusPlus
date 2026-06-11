import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function mysqlManagementOperationRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  if (isMysqlTableMaintenance(operationId)) {
    return mysqlTableMaintenanceRequest(connection, operationId, objectName, parameters)
  }

  if (operationId.endsWith('routine.execute')) {
    return mysqlRoutineExecuteRequest(connection, objectName, parameters)
  }

  if (operationId.endsWith('event.enable') || operationId.endsWith('event.disable')) {
    return mysqlEventStateRequest(connection, operationId, objectName, parameters)
  }

  if (operationId.endsWith('user.lock') || operationId.endsWith('user.unlock')) {
    return mysqlUserAccountRequest(connection, operationId, parameters)
  }

  if (operationId.endsWith('security.inspect')) {
    return mysqlSecurityInspectRequest(connection, parameters)
  }

  return undefined
}

function mysqlTableMaintenanceRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const label = mysqlEngineLabel(connection)
  const operation = tableMaintenanceOperation(operationId)
  const { database, table } = mysqlObjectParts(objectName, parameters)
  const statement = `${operation} table ${objectName};`
  const destructive = operation === 'repair'

  return JSON.stringify({
    workflow: `${connection.engine}.table.maintenance`,
    operation,
    database,
    table,
    statement,
    lockImpact: mysqlMaintenanceLockImpact(operation),
    executionGate: {
      defaultSupport: 'plan-only',
      disabledReason: `${label} ${operation.toUpperCase()} TABLE remains preview-first until the desktop adapter verifies table engine support, privileges, lock impact, and rollback boundaries.`,
      requiredPrivileges: mysqlMaintenancePrivileges(connection, operation),
      guards: [
        'verify target table exists and belongs to the selected database',
        'inspect storage engine support before running',
        'review lock and replication impact',
        'block execution on read-only connections',
        destructive ? 'require owner/admin confirmation and a recent backup before repair' : 'require explicit confirmation before costly maintenance',
      ],
      residualRisk: 'MyISAM and InnoDB differ in CHECK/REPAIR/OPTIMIZE behavior; live execution stays out of scope until fixture-backed.',
    },
  }, null, 2)
}

function mysqlRoutineExecuteRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const label = mysqlEngineLabel(connection)
  const { database, routine } = mysqlRoutineParts(objectName, parameters)
  const routineKind = stringParameter(parameters, 'routineKind')?.toLowerCase().includes('function')
    ? 'function'
    : 'procedure'
  const routineArguments = mysqlRoutineArguments(
    stringParameter(parameters, 'arguments') ?? stringParameter(parameters, 'routineArguments') ?? '',
  )
  const placeholders = routineArguments.map((argument, index) => argument.name ? `${argument.name} => ?` : `? /* arg${index + 1} */`)
  const statement = routineKind === 'function'
    ? `select ${objectName}(${placeholders.join(', ')});`
    : `call ${objectName}(${placeholders.join(', ')});`

  return JSON.stringify({
    workflow: `${connection.engine}.routine.execute`,
    database,
    routine,
    routineKind,
    statement,
    bindings: routineArguments,
    returns: stringParameter(parameters, 'returns') ?? null,
    language: stringParameter(parameters, 'language') ?? 'SQL',
    securityMode: stringParameter(parameters, 'security') ?? 'review definer/invoker metadata',
    executionGate: {
      defaultSupport: 'plan-only',
      disabledReason: `${label} routine execution remains preview-first until parameter binding, OUT/INOUT capture, SQL SECURITY mode, and EXECUTE privilege checks are live-validated.`,
      requiredPrivileges: ['EXECUTE privilege on the routine', 'read/write privileges required by the routine body'],
      guards: [
        'bind every IN parameter explicitly',
        'review OUT and INOUT parameters before running',
        'review SQL SECURITY DEFINER versus INVOKER semantics',
        'block mutating routines on read-only connections',
        'show the generated CALL/SELECT statement before execution',
      ],
      residualRisk: 'Stored routines can perform writes, dynamic SQL, or privileged work through definers; this preview does not claim live side-effect containment.',
    },
  }, null, 2)
}

function mysqlEventStateRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const label = mysqlEngineLabel(connection)
  const action = operationId.endsWith('event.enable') ? 'enable' : 'disable'
  const { database, eventName } = mysqlEventParts(objectName, parameters)

  return JSON.stringify({
    workflow: `${connection.engine}.event.toggle`,
    operation: action,
    database,
    event: eventName,
    statement: `alter event ${objectName} ${action};`,
    executionGate: {
      defaultSupport: 'plan-only',
      disabledReason: `${label} event state changes remain preview-first until EVENT privilege, event scheduler state, definer, and schedule metadata are verified live.`,
      requiredPrivileges: ['EVENT privilege on the schema', 'ALTER privilege for the selected event where required'],
      guards: [
        'verify event exists in the selected schema',
        'review event_scheduler global state',
        'review definer account and SQL SECURITY behavior',
        'review schedule, starts/ends, and time zone before toggling',
        'block execution on read-only connections',
      ],
      residualRisk: 'Toggling events can start background writes or stop maintenance jobs; live execution needs fixture-backed scheduler evidence.',
    },
  }, null, 2)
}

function mysqlUserAccountRequest(
  connection: ConnectionProfile,
  operationId: string,
  parameters: Record<string, unknown>,
) {
  const label = mysqlEngineLabel(connection)
  const action = operationId.endsWith('user.lock') ? 'lock' : 'unlock'
  const userName = stringParameter(parameters, 'userName') ?? stringParameter(parameters, 'roleName') ?? '<user>'
  const userHost = stringParameter(parameters, 'userHost') ?? stringParameter(parameters, 'host') ?? '%'
  const account = quoteMysqlAccount(userName, userHost)

  return JSON.stringify({
    workflow: `${connection.engine}.user.account-state`,
    operation: action,
    user: userName,
    host: userHost,
    statement: `alter user ${account} account ${action};`,
    executionGate: {
      defaultSupport: 'plan-only',
      disabledReason: `${label} account lock/unlock remains preview-first until CREATE USER/ACCOUNT MANAGEMENT privilege checks and active-session impact are live-validated.`,
      requiredPrivileges: ['CREATE USER or SYSTEM_USER-compatible account management privilege'],
      guards: [
        'verify user@host identity before generating ALTER USER',
        'review current account_locked and password_expired state',
        'warn about active sessions and application connection pools',
        'block execution on read-only connections',
        'require explicit confirmation before changing account state',
      ],
      residualRisk: 'Host wildcards and role-like accounts can affect more clients than expected; live execution needs principal selection UI.',
    },
  }, null, 2)
}

function mysqlSecurityInspectRequest(
  connection: ConnectionProfile,
  parameters: Record<string, unknown>,
) {
  const database = stringParameter(parameters, 'database') ?? stringParameter(parameters, 'schema') ?? '<database>'
  const isMariaDb = connection.engine === 'mariadb'

  return JSON.stringify({
    workflow: `${connection.engine}.security.inspect`,
    database,
    statements: [
      'show grants;',
      'select current_user() as currentUser, user() as sessionUser;',
      'select user, host, plugin, account_locked, password_expired from mysql.user order by user, host;',
      'select grantee, privilege_type, is_grantable from information_schema.user_privileges order by grantee, privilege_type;',
      `select grantee, table_schema, privilege_type, is_grantable from information_schema.schema_privileges where table_schema = '${database.replace(/'/g, "''")}' order by grantee, privilege_type;`,
      `select grantee, table_schema, table_name, privilege_type, is_grantable from information_schema.table_privileges where table_schema = '${database.replace(/'/g, "''")}' order by table_name, grantee, privilege_type;`,
      ...(isMariaDb
        ? [
            'select user, host, is_role from mysql.user where is_role = \'Y\' order by user, host;',
            'select from_user, from_host, to_user, to_host from mysql.roles_mapping order by from_user, to_user;',
          ]
        : []),
    ],
    executionGate: {
      defaultSupport: 'live',
      requiredPrivileges: ['SHOW GRANTS visibility', 'mysql.user or INFORMATION_SCHEMA privilege visibility'],
      guards: [
        'redact principal names from exported diagnostics where configured',
        'tolerate hidden mysql.* tables when the login lacks catalog privileges',
        'separate global, schema, table, and routine grants',
        'never infer write privilege from missing grant rows',
      ],
      residualRisk: isMariaDb
        ? 'MariaDB services can hide mysql.user or mysql.roles_mapping; unavailable role surfaces must render disabled reasons instead of empty success.'
        : 'Managed MySQL services can hide mysql.user or role_edges; unavailable surfaces must render disabled reasons instead of empty success.',
    },
  }, null, 2)
}

function isMysqlTableMaintenance(operationId: string) {
  return [
    'table.check',
    'table.analyze',
    'table.optimize',
    'table.repair',
  ].some((suffix) => operationId.endsWith(suffix))
}

function tableMaintenanceOperation(operationId: string) {
  if (operationId.endsWith('table.analyze')) return 'analyze'
  if (operationId.endsWith('table.optimize')) return 'optimize'
  if (operationId.endsWith('table.repair')) return 'repair'
  return 'check'
}

function mysqlMaintenanceLockImpact(operation: string) {
  if (operation === 'check') return 'metadata and engine-dependent read locks'
  if (operation === 'analyze') return 'statistics refresh can sample or scan index pages'
  if (operation === 'optimize') return 'may rebuild or copy table data depending on engine'
  return 'engine-dependent repair can rebuild indexes or modify table files'
}

function mysqlMaintenancePrivileges(connection: ConnectionProfile, operation: string) {
  if (operation === 'check') return ['SELECT privilege on the target table']
  if (operation === 'analyze' && connection.engine === 'mariadb') return ['ANALYZE/TABLE maintenance privilege or table ownership/admin equivalent']
  if (operation === 'analyze') return ['INSERT or UPDATE privilege on the target table in MySQL 8.0.31+, or table ownership/admin equivalent']
  if (operation === 'optimize') return ['INSERT and SELECT privilege on the target table, or table ownership/admin equivalent']
  return ['REPAIR privilege on the target table, or table ownership/admin equivalent']
}

function mysqlEngineLabel(connection: ConnectionProfile) {
  return connection.engine === 'mariadb' ? 'MariaDB' : 'MySQL'
}

function mysqlObjectParts(objectName: string, parameters: Record<string, unknown>) {
  const explicitDatabase = stringParameter(parameters, 'database') ?? stringParameter(parameters, 'schema')
  const explicitTable = stringParameter(parameters, 'table') ?? stringParameter(parameters, 'tableName')
  if (explicitTable) {
    return { database: explicitDatabase ?? '<database>', table: explicitTable }
  }

  const parts = splitMysqlName(objectName)
  if (parts.length >= 2) {
    return { database: explicitDatabase ?? parts[0] ?? '<database>', table: parts[1] ?? '<table>' }
  }
  return { database: explicitDatabase ?? '<database>', table: parts[0] ?? '<table>' }
}

function mysqlRoutineParts(objectName: string, parameters: Record<string, unknown>) {
  const parts = mysqlObjectParts(objectName, {
    ...parameters,
    table: stringParameter(parameters, 'routineName') ?? stringParameter(parameters, 'table'),
  })
  return { database: parts.database, routine: parts.table }
}

function mysqlEventParts(objectName: string, parameters: Record<string, unknown>) {
  const parts = mysqlObjectParts(objectName, {
    ...parameters,
    table: stringParameter(parameters, 'eventName') ?? stringParameter(parameters, 'table'),
  })
  return { database: parts.database, eventName: parts.table }
}

function splitMysqlName(value: string) {
  const parts: string[] = []
  let current = ''
  let quote: '`' | '"' | undefined
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index + 1] === quote) {
        current += char
        index += 1
      } else if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
    } else if (char === '`' || char === '"') {
      quote = char
    } else if (char === '.') {
      parts.push(cleanMysqlIdentifier(current))
      current = ''
    } else {
      current += char
    }
  }
  parts.push(cleanMysqlIdentifier(current))
  return parts.filter(Boolean)
}

function cleanMysqlIdentifier(value: string) {
  return value
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/``/g, '`')
    .replace(/""/g, '"')
}

function mysqlRoutineArguments(value: string) {
  return splitRoutineArguments(value).map((raw, index) => {
    const tokens = raw.trim().split(/\s+/).filter(Boolean)
    const direction = /^(in|out|inout)$/i.test(tokens[0] ?? '') ? tokens.shift()!.toUpperCase() : 'IN'
    const name = cleanRoutineArgumentName(tokens.shift() ?? `arg${index + 1}`)
    const type = tokens.join(' ') || 'unknown'
    return {
      position: index + 1,
      direction,
      name,
      type,
      placeholder: '?',
    }
  })
}

function splitRoutineArguments(value: string) {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')' && depth > 0) depth -= 1
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function cleanRoutineArgumentName(value: string) {
  return cleanMysqlIdentifier(value).replace(/^@+/, '') || 'arg'
}

function quoteMysqlAccount(user: string, host: string) {
  return `'${user.replace(/'/g, "''")}'@'${host.replace(/'/g, "''")}'`
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
