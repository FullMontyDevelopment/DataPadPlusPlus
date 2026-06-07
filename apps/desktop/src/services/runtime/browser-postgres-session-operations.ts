export function postgresSessionOperationRequest(
  operationId: string,
  parameters: Record<string, unknown>,
) {
  const terminate = operationId.endsWith('session.terminate')
  const pid = postgresBackendPid(parameters)
  const pidToken = pid ? String(pid) : '<backend_pid>'
  const functionName = terminate ? 'pg_terminate_backend' : 'pg_cancel_backend'
  const resultName = terminate ? 'terminate_requested' : 'cancel_requested'
  const action = terminate ? 'terminate backend' : 'cancel query'
  const target = postgresSessionTarget(parameters, pidToken)
  const statement = pid
    ? [
        'select case',
        `  when pg_backend_pid() = ${pid} then false`,
        `  else ${functionName}(${pid})`,
        `end as ${resultName};`,
      ].join('\n')
    : [
        '-- Provide a concrete backend PID before execution.',
        `select ${functionName}(<backend_pid>) as ${resultName};`,
      ].join('\n')

  return [
    '-- PostgreSQL backend action preview.',
    `-- Action: ${action}.`,
    '-- Requires pg_signal_backend, matching ownership, or superuser privileges.',
    '-- Verify PID, user, database, application, state, and current query before running.',
    terminate
      ? '-- Terminating a backend disconnects the client and rolls back its active transaction.'
      : '-- Canceling asks PostgreSQL to interrupt the active query while keeping the connection alive.',
    `-- Target: ${target}`,
    statement,
  ].join('\n')
}

function postgresBackendPid(parameters: Record<string, unknown>) {
  return numericParameter(parameters, 'pid') ??
    numericParameter(parameters, 'backendPid') ??
    numericParameter(parameters, 'sessionPid')
}

function postgresSessionTarget(parameters: Record<string, unknown>, pidToken: string) {
  const parts = [
    `pid ${pidToken}`,
    stringParameter(parameters, 'sessionUser') ? `user ${stringParameter(parameters, 'sessionUser')}` : undefined,
    stringParameter(parameters, 'sessionDatabase') ? `database ${stringParameter(parameters, 'sessionDatabase')}` : undefined,
    stringParameter(parameters, 'application') ? `application ${stringParameter(parameters, 'application')}` : undefined,
    stringParameter(parameters, 'sessionState') ? `state ${stringParameter(parameters, 'sessionState')}` : undefined,
  ].filter(Boolean)

  return parts.join(', ')
}

function numericParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\D+/g, ''))
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
