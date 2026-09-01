export function fixtureStateNeedsRecreate(state) {
  if (!state) {
    return false
  }

  const status = normalizedStateValue(state.Status)
  const health = normalizedStateValue(state.Health?.Status)

  return ['dead', 'exited'].includes(status) || health === 'unhealthy'
}

export function shouldValidateFixtureCredentials(state) {
  return (
    normalizedStateValue(state?.Status) === 'running' &&
    normalizedStateValue(state?.Health?.Status) === 'healthy'
  )
}

export function fixtureStateReason(service, state) {
  const status = normalizedStateValue(state?.Status)
  const health = normalizedStateValue(state?.Health?.Status)

  if (['dead', 'exited'].includes(status)) {
    const exitCode = Number.isInteger(state?.ExitCode) ? ` with exit code ${state.ExitCode}` : ''
    return `${service} ${status}${exitCode}`
  }

  if (health === 'unhealthy') {
    return `${service} is unhealthy`
  }

  return `${service} failed to become ready`
}

function normalizedStateValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
