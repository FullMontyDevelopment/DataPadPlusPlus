import type { OracleConnectionOptions } from '@datapadplusplus/shared-types'

export function validateOracleConnectionOptions(
  options: OracleConnectionOptions | null | undefined,
): OracleConnectionOptions | undefined {
  if (!options) {
    return undefined
  }

  return {
    ...options,
    requestTimeoutMs: optionalInteger(
      options.requestTimeoutMs,
      'Oracle request timeout',
      1_000,
      300_000,
    ),
  }
}

function optionalInteger(
  value: number | undefined,
  label: string,
  min: number,
  max: number,
) {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
  }
  return value
}
