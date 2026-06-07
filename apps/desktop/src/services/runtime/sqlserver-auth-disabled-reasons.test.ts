import { describe, expect, it } from 'vitest'
import { sqlServerAuthSupport } from './sqlserver-auth-disabled-reasons'

describe('sqlServerAuthSupport', () => {
  it('marks SQL Server login as live-capable', () => {
    expect(sqlServerAuthSupport({ authenticationMode: 'sql-server' })).toEqual({
      live: true,
      evidence: 'live',
    })
  })

  it('explains plan-only Microsoft Entra and certificate modes with mode-specific reasons', () => {
    expect(
      sqlServerAuthSupport({ authenticationMode: 'azure-ad-service-principal' }).disabledReason,
    ).toContain('tenant id, client id')

    expect(
      sqlServerAuthSupport({
        authenticationMode: 'azure-ad-service-principal',
        azureTenantId: 'tenant',
        azureClientId: 'client',
        servicePrincipalSecretRef: {
          id: 'secret-sp',
          provider: 'os-keyring',
          service: 'DataPad++',
          account: 'conn-sqlserver',
          label: 'SQL Server service principal',
        },
      }).disabledReason,
    ).toContain('token exchange is not wired')

    expect(
      sqlServerAuthSupport({
        authenticationMode: 'azure-ad-managed-identity',
        azureManagedIdentityClientId: 'mi-client',
      }).disabledReason,
    ).toContain('Managed identity client id is saved')

    expect(sqlServerAuthSupport({ authenticationMode: 'certificate' }).disabledReason).toContain(
      'client certificate path or certificate store/thumbprint',
    )
  })
})
