import type { MySqlConnectionOptions } from '@datapadplusplus/shared-types'

export interface MySqlAuthSupport {
  live: boolean
  disabledReason?: string
}

const TLS_REQUIRED_MODES = new Set<MySqlConnectionOptions['sslMode']>([
  'required',
  'verify-ca',
  'verify-identity',
])

export function mysqlAuthSupport(
  options: MySqlConnectionOptions | undefined,
  engineLabel = 'MySQL',
): MySqlAuthSupport {
  const authMode = options?.authMode ?? 'password'

  if (authMode === 'password') {
    return { live: true }
  }

  if (authMode === 'cleartext-plugin') {
    if (!TLS_REQUIRED_MODES.has(options?.sslMode)) {
      return {
        live: false,
        disabledReason:
          'Cleartext plugin authentication must require TLS before live testing is enabled.',
      }
    }

    return {
      live: false,
      disabledReason:
        `Cleartext plugin authentication is preserved as ${engineLabel} profile metadata until a live mysql_clear_password gate is validated.`,
    }
  }

  return {
    live: false,
    disabledReason:
      `IAM token authentication needs provider-specific token generation and stays plan-only in this scoped ${engineLabel} claim.`,
  }
}
