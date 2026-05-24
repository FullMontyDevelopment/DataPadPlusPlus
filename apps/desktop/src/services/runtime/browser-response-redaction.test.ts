import { describe, expect, it } from 'vitest'
import type { ResolvedEnvironment } from '@datapadplusplus/shared-types'
import {
  redactForEnvironment,
  redactResultPageForEnvironment,
} from './browser-response-redaction'

function secretEnvironment(): ResolvedEnvironment {
  return {
    environmentId: 'env-qa',
    label: 'QA',
    risk: 'low',
    variables: {
      API_TOKEN: 'super-secret-token',
    },
    unresolvedKeys: [],
    inheritedChain: ['QA'],
    sensitiveKeys: ['API_TOKEN'],
    variableDefinitions: [],
  }
}

describe('browser response redaction', () => {
  it('redacts resolved secret values inside nested browser runtime responses', () => {
    const redacted = redactForEnvironment(
      {
        summary: 'used super-secret-token',
        result: {
          payloads: [
            {
              renderer: 'json',
              value: {
                text: 'super-secret-token',
              },
            },
          ],
        },
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).toContain('********')
  })

  it('redacts secret-like payload fields even without secret variables', () => {
    const redacted = redactForEnvironment(
      {
        username: 'ada',
        password: 'plain-password',
        nested: {
          apiToken: 'plain-token',
        },
      },
      {
        ...secretEnvironment(),
        variables: {},
        sensitiveKeys: [],
      },
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).toContain('ada')
    expect(serialized).not.toContain('plain-password')
    expect(serialized).not.toContain('plain-token')
  })

  it('redacts result page payloads and notices before they reach the UI', () => {
    const redacted = redactResultPageForEnvironment(
      {
        tabId: 'tab-1',
        payload: {
          renderer: 'table',
          columns: ['token'],
          rows: [['super-secret-token']],
        },
        pageInfo: {
          pageSize: 20,
          pageIndex: 1,
          bufferedRows: 1,
          hasMore: false,
        },
        notices: ['loaded super-secret-token'],
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).toContain('********')
  })
})
