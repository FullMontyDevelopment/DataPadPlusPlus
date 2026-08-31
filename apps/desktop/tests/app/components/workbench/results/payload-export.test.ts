import type { ResultPayload } from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyText,
  createResultExportFile,
  exportOptionsForPayload,
  payloadToText,
  serializePayloadForExport,
} from '../../../../../src/app/components/workbench/results/payload-export'

describe('exact payload export', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves secret-like table columns and credential-shaped datastore strings', () => {
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
      'username,password,notes\nadmin,open-sesame,mongodb://user:secret@localhost:27017/catalog',
    )
  })

  it('preserves scalar secret-like fields from document exports', () => {
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

    expect(payloadToText(payload)).toContain('"token": "abc123"')
    expect(payloadToText(payload)).toContain('"accessToken": "camel-secret"')
    expect(payloadToText(payload)).toContain('Fixture User')
  })

  it('preserves key/value entries when the key name is secret-like', () => {
    const payload: ResultPayload = {
      renderer: 'keyvalue',
      entries: {
        password: 'redis-secret',
        status: 'active',
      },
    }

    expect(serializePayloadForExport(payload, 'json')).toContain('"password": "redis-secret"')
    expect(payloadToText(payload)).toContain('"password": "redis-secret"')
  })

  it('copies the exact displayed text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await copyText('Bearer abc123 password=open-sesame')

    expect(writeText).toHaveBeenCalledWith('Bearer abc123 password=open-sesame')
  })

  it('offers row-oriented export formats for document payloads', () => {
    const payload: ResultPayload = {
      renderer: 'document',
      documents: [
        { _id: 1, profile: { name: 'Ada' }, roles: ['admin'] },
        { _id: 2, profile: { name: 'Lin' }, roles: ['reader'] },
      ],
    }

    expect(exportOptionsForPayload(payload).map((option) => option.format)).toEqual([
      'json',
      'ndjson',
      'csv',
    ])
    expect(serializePayloadForExport(payload, 'csv')).toBe(
      '_id,profile.name,roles\n1,Ada,"[""admin""]"\n2,Lin,"[""reader""]"',
    )
    expect(serializePayloadForExport(payload, 'ndjson')).toContain('{"_id":1')
  })

  it('builds exact export file requests with the selected format', () => {
    const payload: ResultPayload = {
      renderer: 'table',
      columns: ['token', 'value'],
      rows: [['plain-secret', '42']],
    }
    const option = exportOptionsForPayload(payload).find((item) => item.format === 'json')

    expect(option).toBeDefined()
    const file = createResultExportFile(payload, undefined, option!)

    expect(file).toMatchObject({
      extension: 'json',
      mimeType: 'application/json;charset=utf-8',
    })
    expect(file.contents).toContain('plain-secret')
    expect(file.contents).not.toContain('********')
  })
})
