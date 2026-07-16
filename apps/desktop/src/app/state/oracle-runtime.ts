import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function connectionUsesManagedOracleRuntime(connection?: ConnectionProfile) {
  if (!connection || connection.engine !== 'oracle') {
    return true
  }

  return (connection.oracleOptions?.executionRuntime?.trim() || 'managed') === 'managed'
}
