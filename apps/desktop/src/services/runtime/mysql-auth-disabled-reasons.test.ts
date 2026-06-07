import { describe, expect, it } from 'vitest'
import { mysqlAuthSupport } from './mysql-auth-disabled-reasons'

describe('mysqlAuthSupport', () => {
  it('keeps password auth live and explains plan-only cleartext/IAM modes', () => {
    expect(mysqlAuthSupport({ authMode: 'password' })).toMatchObject({ live: true })

    expect(mysqlAuthSupport({ authMode: 'cleartext-plugin', sslMode: 'disabled' })).toMatchObject({
      live: false,
      disabledReason: expect.stringContaining('must require TLS'),
    })

    expect(
      mysqlAuthSupport({ authMode: 'cleartext-plugin', sslMode: 'verify-identity' }),
    ).toMatchObject({
      live: false,
      disabledReason: expect.stringContaining('mysql_clear_password gate'),
    })

    expect(mysqlAuthSupport({ authMode: 'iam-token', sslMode: 'required' })).toMatchObject({
      live: false,
      disabledReason: expect.stringContaining('provider-specific token generation'),
    })

    expect(mysqlAuthSupport({ authMode: 'iam-token', sslMode: 'required' }, 'MariaDB')).toMatchObject({
      live: false,
      disabledReason: expect.stringContaining('scoped MariaDB claim'),
    })
  })
})
