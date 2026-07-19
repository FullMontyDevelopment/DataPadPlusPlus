import type {
  AppHealth,
  ConnectionProfile,
  DiagnosticsReport,
  EnvironmentProfile,
  GuardrailDecision,
  ResolvedEnvironment,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { resolveEnvironmentVariablesForPreview } from './environment-variables'
import { classifyMongoScriptRisk } from './environment-guardrails-mongo'

export function resolveEnvironment(
  environments: EnvironmentProfile[],
  environmentId: string,
): ResolvedEnvironment {
  if (!environmentId.trim()) {
    return {
      environmentId: '',
      label: 'No environment',
      risk: 'low',
      variables: {},
      unresolvedKeys: [],
      inheritedChain: [],
      sensitiveKeys: [],
      variableDefinitions: [],
    }
  }

  const fallback =
    environments[0] ??
    ({
      id: 'environment-missing',
      label: 'Missing environment',
      color: '#000000',
      risk: 'low',
      variables: {},
      sensitiveKeys: [],
      variableDefinitions: [],
      requiresConfirmation: false,
      safeMode: false,
      exportable: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies EnvironmentProfile)
  const environmentMap = new Map(
    environments.map((environment) => [environment.id, environment]),
  )
  const resolvedChain: EnvironmentProfile[] = []
  const visited = new Set<string>()
  let current = environmentMap.get(environmentId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    resolvedChain.unshift(current)
    current = current.inheritsFrom
      ? environmentMap.get(current.inheritsFrom)
      : undefined
  }

  const activeEnvironment = environmentMap.get(environmentId) ?? fallback
  const inheritedChain: string[] = []

  for (const environment of resolvedChain) {
    inheritedChain.push(environment.label)
  }
  const resolved = resolveEnvironmentVariablesForPreview(resolvedChain)

  return {
    environmentId: activeEnvironment.id,
    label: activeEnvironment.label,
    risk: activeEnvironment.risk,
    variables: resolved.variables,
    unresolvedKeys: resolved.unresolvedKeys,
    inheritedChain,
    sensitiveKeys: resolved.sensitiveKeys,
    variableDefinitions: resolved.variableDefinitions,
  }
}

export function evaluateGuardrails(
  connection: ConnectionProfile,
  environment: EnvironmentProfile,
  resolvedEnvironment: ResolvedEnvironment,
  queryText: string,
  safeModeEnabled: boolean,
): GuardrailDecision {
  const reasons: string[] = []
  const queryRisk = classifyQueryRisk(connection, queryText)
  const looksWrite = queryRisk.looksWrite
  const safeModeApplied = looksWrite && (safeModeEnabled || environment.safeMode)

  if (resolvedEnvironment.unresolvedKeys.length > 0) {
    reasons.push('Unresolved environment variables must be fixed before execution.')
    return {
      status: 'block',
      reasons,
      safeModeApplied,
    }
  }

  if (connection.readOnly && looksWrite) {
    reasons.push('This connection is marked read-only.')
    return {
      status: 'block',
      reasons,
      safeModeApplied,
    }
  }

  if (looksWrite) {
    if (safeModeEnabled) {
      reasons.push('Global safe mode requires confirmation for risky work.')
    }

    if (environment.safeMode) {
      reasons.push(
        `${environment.label} safe mode requires confirmation for risky work.`,
      )
    }

    if (environment.requiresConfirmation) {
      reasons.push(`${environment.label} requires confirmation for risky work.`)
    }

    if (environment.risk === 'high' || environment.risk === 'critical') {
      reasons.push(`${environment.label} is a ${environment.risk} risk environment.`)
    }
  }

  if (queryRisk.alwaysConfirmReason) {
    reasons.push(queryRisk.alwaysConfirmReason)
  }

  if (reasons.length > 0) {
    return {
      status: 'confirm',
      reasons,
      safeModeApplied,
      requiredConfirmationText: `CONFIRM ${environment.label}`,
    }
  }

  reasons.push('Guardrails cleared for the current query.')

  return {
    status: 'allow',
    reasons,
    safeModeApplied,
  }
}

interface QueryRisk {
  looksWrite: boolean
  alwaysConfirmReason?: string
}

function classifyQueryRisk(connection: ConnectionProfile, queryText: string): QueryRisk {
  if (connection.engine === 'mongodb') {
    return classifyMongoQueryRisk(queryText)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return classifyRedisQueryRisk(queryText)
  }

  if (connection.engine === 'oracle') {
    return classifyOracleQueryRisk(queryText)
  }

  return classifyTokenizedQueryRisk(queryText)
}

function classifyOracleQueryRisk(queryText: string): QueryRisk {
  const tokens = queryTokens(stripOracleCommentsAndLiterals(queryText))
  const first = tokens[0] ?? ''
  const plsqlOrCall = ['begin', 'declare', 'call', 'exec', 'execute'].includes(first)
  const transactionControl = ['commit', 'rollback', 'savepoint', 'set'].includes(first)
  const lockingSelect = tokenSequence(tokens, 'for', 'update')
  const dynamicSql = tokenSequence(tokens, 'execute', 'immediate')
  const admin = tokenSequence(tokens, 'alter', 'system') ||
    tokenSequence(tokens, 'alter', 'session') || first === 'lock'
  const generic = classifyTokens(tokens)
  if (plsqlOrCall || transactionControl || dynamicSql || admin) {
    return {
      looksWrite: true,
      alwaysConfirmReason: 'Oracle PL/SQL, transaction, and administrative statements require confirmation before execution.',
    }
  }
  if (lockingSelect) {
    return {
      looksWrite: true,
      alwaysConfirmReason: 'Oracle SELECT FOR UPDATE acquires row locks and requires confirmation before execution.',
    }
  }
  return generic
}

function classifyMongoQueryRisk(queryText: string): QueryRisk {
  try {
    const input = JSON.parse(queryText) as Record<string, unknown>
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return classifyTokenizedQueryRisk(queryText)
    }

    const operation = normalizeOperation(
      stringValue(input.operation) ??
        stringValue(input.op) ??
        (input.command && typeof input.command === 'object' ? 'runcommand' : 'find'),
    )

    if ([
      'insertone',
      'insertmany',
      'updateone',
      'updatemany',
      'replaceone',
      'deleteone',
      'deletemany',
      'bulkwrite',
    ].includes(operation)) {
      return {
        looksWrite: true,
        alwaysConfirmReason: 'MongoDB raw write operations require confirmation before execution.',
      }
    }

    if (operation === 'runcommand') {
      const command = input.command
      const commandName =
        command && typeof command === 'object' && !Array.isArray(command)
          ? Object.keys(command)[0]?.toLowerCase()
          : undefined

      if (
        commandName &&
        ['drop', 'dropdatabase', 'collmod', 'create', 'createindexes', 'dropindexes']
          .includes(commandName)
      ) {
        return {
          looksWrite: true,
          alwaysConfirmReason:
            'MongoDB administrative commands require confirmation before execution.',
        }
      }
    }

    return { looksWrite: false }
  } catch {
    return classifyMongoScriptRisk(queryText)
  }
}

function classifyRedisQueryRisk(queryText: string): QueryRisk {
  const command = queryTokens(queryText)[0] ?? ''

  if (!command) {
    return { looksWrite: false }
  }

  if (['del', 'unlink', 'flushdb', 'flushall', 'restore', 'rename', 'renamenx'].includes(command)) {
    return {
      looksWrite: true,
      alwaysConfirmReason: 'Redis destructive keyspace operations require confirmation before execution.',
    }
  }

  return {
    looksWrite: [
      'set',
      'mset',
      'setex',
      'psetex',
      'hset',
      'hmset',
      'hdel',
      'lpush',
      'rpush',
      'lset',
      'lrem',
      'sadd',
      'srem',
      'zadd',
      'zrem',
      'xadd',
      'xdel',
      'expire',
      'pexpire',
      'persist',
      'json.set',
      'json.del',
    ].includes(command),
  }
}

function classifyTokenizedQueryRisk(queryText: string): QueryRisk {
  const tokens = queryTokens(queryText)
  return classifyTokens(tokens)
}

function classifyTokens(tokens: string[]): QueryRisk {
  const looksWrite = tokens.some((token) =>
    [
      'insert',
      'update',
      'delete',
      'drop',
      'truncate',
      'alter',
      'create',
      'merge',
      'replace',
      'grant',
      'revoke',
      'flushdb',
      'flushall',
    ].includes(token),
  )
  const destructive = tokens.some((token) =>
    ['delete', 'drop', 'truncate', 'flushdb', 'flushall'].includes(token),
  )

  return {
    looksWrite,
    alwaysConfirmReason: destructive
      ? 'Destructive operations require confirmation before execution.'
      : undefined,
  }
}

function tokenSequence(tokens: string[], first: string, second: string) {
  return tokens.some((token, index) => token === first && tokens[index + 1] === second)
}

function stripOracleCommentsAndLiterals(queryText: string) {
  return queryText
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
    .replace(/"(?:""|[^"])*"/g, ' ')
}

function queryTokens(queryText: string) {
  return queryText
    .split(/[^A-Za-z0-9_.]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeOperation(value: string) {
  return value.replace(/[_\-\s]/g, '').toLowerCase()
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function buildDiagnosticsReport(
  snapshot: WorkspaceSnapshot,
  health: AppHealth,
): DiagnosticsReport {
  const warnings: string[] = []

  if (snapshot.lockState.isLocked) {
    warnings.push('Application is currently locked.')
  }

  if (snapshot.preferences.telemetry === 'disabled') {
    warnings.push('Crash reporting is disabled.')
  }

  if (
    snapshot.environments.some((environment) => environment.risk === 'critical')
  ) {
    warnings.push('Critical environments are configured in this workspace.')
  }

  return {
    createdAt: new Date().toISOString(),
    runtime: health.runtime,
    platform: health.platform,
    appVersion: '0.1.0',
    logPath: undefined,
    breadcrumbPath: undefined,
    counts: {
      connections: snapshot.connections.length,
      environments: snapshot.environments.length,
      tabs: snapshot.tabs.length,
      savedWork: snapshot.savedWork.length,
      library: snapshot.libraryNodes.length,
    },
    warnings,
  }
}
