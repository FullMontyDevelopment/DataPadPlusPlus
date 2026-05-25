import type { ResultPayload } from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, payloadToText, sanitizePayloadForExport } from './payload-export'

describe('payload export security', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redacts secret-like table columns and connection strings', () => {
    const payload: ResultPayload = {
      renderer: 'table',
      columns: ['username', 'password', 'notes'],
      rows: [
        [
          'admin',
          'open-sesame',
          'mongodb://user:secret@localhost:27017/catalog',
        ],
      ],
    }

    expect(payloadToText(payload)).toBe(
      'username,password,notes\nadmin,********,mongodb://********@localhost:27017/catalog',
    )
  })

  it('redacts scalar secret fields from document exports', () => {
    const payload: ResultPayload = {
      renderer: 'document',
      documents: [
        {
          _id: 'user-1',
          profile: {
            token: 'abc123',
            accessToken: 'camel-secret',
            name: 'Fixture User',
          },
        },
      ],
    }

    expect(payloadToText(payload)).toContain('"token": "********"')
    expect(payloadToText(payload)).not.toContain('abc123')
    expect(payloadToText(payload)).not.toContain('camel-secret')
    expect(payloadToText(payload)).toContain('Fixture User')
  })

  it('redacts key/value entries when the key name is secret-like', () => {
    const payload: ResultPayload = {
      renderer: 'keyvalue',
      entries: {
        password: 'redis-secret',
        status: 'active',
      },
    }

    const exported = sanitizePayloadForExport(payload)

    expect(exported).toMatchObject({
      renderer: 'keyvalue',
      entries: {
        password: '********',
        status: 'active',
      },
    })
  })

  it('redacts copied text before writing to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await copyText('Bearer abc123 password=open-sesame')

    expect(writeText).toHaveBeenCalledWith('Bearer ******** password=********')
  })
})
