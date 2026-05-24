import { describe, expect, it } from 'vitest'
import {
  connectionStringContainsPlainSecret,
  redactErrorMessage,
  redactSensitiveText,
} from './security-redaction'

describe('security redaction', () => {
  it('redacts common secret assignments and authorization headers', () => {
    expect(
      redactSensitiveText(
        'Password=super-secret; token: abc123 Bearer eyJhbGciOiJub25l',
      ),
    ).toBe('Password=********; token: ******** Bearer ********')
  })

  it('redacts credentials embedded in URLs', () => {
    expect(
      redactSensitiveText('mongodb://user:secret@localhost:27017/catalog'),
    ).toBe('mongodb://********@localhost:27017/catalog')
  })

  it('redacts secret query parameters without hiding safe parameters', () => {
    expect(
      redactSensitiveText(
        'postgres://localhost/app?password=open-sesame&sslmode=require',
      ),
    ).toBe('postgres://localhost/app?password=********&sslmode=require')
  })

  it('redacts error messages before they enter workbench messages', () => {
    expect(
      redactErrorMessage(
        new Error('Connection failed: pwd=secret-value'),
        'fallback',
      ),
    ).toBe('Connection failed: pwd=********')
  })

  it('redacts object-like thrown messages', () => {
    expect(
      redactErrorMessage(
        { message: 'Driver failed with api_key=abc123' },
        'fallback',
      ),
    ).toBe('Driver failed with api_key=********')
  })

  it('redacts JSON-style secret properties while preserving readable JSON shape', () => {
    expect(
      redactSensitiveText('{ "password": "open-sesame", "safe": true, "pwd": 42 }'),
    ).toBe('{ "password": "********", "safe": true, "pwd": ******** }')
  })

  it('does not corrupt object-valued fields that happen to use secret-like names', () => {
    expect(
      redactSensitiveText('{ "properties": { "password": { "bsonType": "string" } } }'),
    ).toBe('{ "properties": { "password": { "bsonType": "string" } } }')
  })

  it('detects plaintext credentials in connection strings without blocking variable placeholders', () => {
    expect(
      connectionStringContainsPlainSecret('mongodb://user:plain-secret@localhost/catalog'),
    ).toBe(true)
    expect(
      connectionStringContainsPlainSecret('https://service.local?access_token=plain-secret'),
    ).toBe(true)
    expect(
      connectionStringContainsPlainSecret('Server=localhost;Password={{DB_PASSWORD}};'),
    ).toBe(false)
  })
})
