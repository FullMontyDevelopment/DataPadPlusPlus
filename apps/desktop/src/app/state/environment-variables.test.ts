import { describe, expect, it } from 'vitest'
import type { EnvironmentProfile } from '@datapadplusplus/shared-types'
import {
  MASKED_SECRET_VALUE,
  hasUnresolvedEnvironmentVariables,
  interpolateEnvironmentVariables,
  legacyToBraceVariables,
  referencedEnvironmentVariableKeys,
  referencedSensitiveEnvironmentVariableKeys,
  sanitizeEnvironmentProfile,
  variableDefinitionsForEnvironment,
  resolveEnvironmentVariablesForPreview,
} from './environment-variables'

const baseEnvironment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#2dbf9b',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z',
}

describe('environment variables', () => {
  it('migrates legacy variable syntax and interpolates brace variables', () => {
    expect(legacyToBraceVariables('host=${DB_HOST};db={{DB_NAME}}')).toBe(
      'host={{DB_HOST}};db={{DB_NAME}}',
    )
    expect(
      interpolateEnvironmentVariables('select * from {{DB_SCHEMA}}.accounts', {
        DB_SCHEMA: 'public',
      }),
    ).toBe('select * from public.accounts')
  })

  it('normalizes legacy sensitive variables into secret definitions without plaintext values', () => {
    const sanitized = sanitizeEnvironmentProfile({
      ...baseEnvironment,
      variables: {
        DB_HOST: 'localhost',
        API_TOKEN: 'plaintext-token',
      },
      sensitiveKeys: ['API_TOKEN'],
    })

    expect(sanitized.variables).toEqual({ DB_HOST: 'localhost' })
    expect(sanitized.sensitiveKeys).toEqual(['API_TOKEN'])
    expect(sanitized.variableDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'DB_HOST', kind: 'text', value: 'localhost' }),
        expect.objectContaining({
          key: 'API_TOKEN',
          kind: 'secret',
          value: undefined,
          secretRef: expect.objectContaining({
            account: 'environment:env-local:API_TOKEN',
          }),
        }),
      ]),
    )
    expect(JSON.stringify(sanitized)).not.toContain('plaintext-token')
  })

  it('resolves inherited variables for preview while masking secrets', () => {
    const parent = sanitizeEnvironmentProfile({
      ...baseEnvironment,
      id: 'env-parent',
      variables: {
        DB_HOST: 'localhost',
        API_TOKEN: 'legacy-secret',
      },
      sensitiveKeys: ['API_TOKEN'],
    })
    const child = sanitizeEnvironmentProfile({
      ...baseEnvironment,
      id: 'env-child',
      inheritsFrom: 'env-parent',
      variableDefinitions: [
        { key: 'DB_URL', kind: 'text', value: 'postgres://{{DB_HOST}}/app' },
      ],
    })

    const resolved = resolveEnvironmentVariablesForPreview([parent, child])

    expect(resolved.variables.DB_HOST).toBe('localhost')
    expect(resolved.variables.DB_URL).toBe('postgres://localhost/app')
    expect(resolved.variables.API_TOKEN).toBe(MASKED_SECRET_VALUE)
    expect(resolved.sensitiveKeys).toEqual(['API_TOKEN'])
  })

  it('filters invalid variable names and reports unresolved tokens', () => {
    expect(
      variableDefinitionsForEnvironment({
        ...baseEnvironment,
        variableDefinitions: [
          { key: 'valid_name', kind: 'text', value: 'ok' },
          { key: 'bad-name', kind: 'text', value: 'ignored' },
        ],
      }),
    ).toEqual([expect.objectContaining({ key: 'VALID_NAME', value: 'ok' })])

    expect(hasUnresolvedEnvironmentVariables('select * from {{MISSING}}')).toBe(true)
    expect(hasUnresolvedEnvironmentVariables('select * from ${LEGACY}')).toBe(true)
    expect(hasUnresolvedEnvironmentVariables('select 1')).toBe(false)
  })

  it('finds referenced variables and identifies sensitive references', () => {
    expect(
      referencedEnvironmentVariableKeys(
        'select * from {{DB_SCHEMA}}.accounts where token = ${API_TOKEN}',
      ),
    ).toEqual(['DB_SCHEMA', 'API_TOKEN'])
    expect(
      referencedSensitiveEnvironmentVariableKeys(
        'select * from {{DB_SCHEMA}}.accounts where token = {{API_TOKEN}}',
        ['api_token'],
      ),
    ).toEqual(['API_TOKEN'])
  })
})
