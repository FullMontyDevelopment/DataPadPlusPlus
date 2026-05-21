import { describe, expect, it } from 'vitest'
import { redactErrorMessage, redactSensitiveText } from './security-redaction'

describe('security redaction', () => {
  it('redacts common secret assignments and authorization headers', () => {
    expect(
      redactSensitiveText(
        'Password=super-secret; token: abc123 Bearer eyJhbGciOiJub25l',
      ),
    ).toBe('Password=********; token=******** Bearer ********')
  })

  it('redacts credentials embedded in URLs', () => {
    expect(
      redactSensitiveText('mongodb://user:secret@localhost:27017/catalog'),
    ).toBe('mongodb://********@localhost:27017/catalog')
  })

  it('redacts error messages before they enter workbench messages', () => {
    expect(
      redactErrorMessage(
        new Error('Connection failed: pwd=secret-value'),
        'fallback',
      ),
    ).toBe('Connection failed: pwd=********')
  })
})
