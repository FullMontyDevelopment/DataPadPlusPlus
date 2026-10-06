import type {
  SqlServerAuthenticationMode,
  SqlServerConnectionOptions,
} from '@datapadplusplus/shared-types'

export type SqlServerAuthSupport = {
  live: boolean
  evidence: 'live' | 'plan-only'
  disabledReason?: string
}

export function sqlServerAuthSupport(
  options?: Pick<
    SqlServerConnectionOptions,
    | 'authenticationMode'
    | 'azureTenantId'
    | 'azureClientId'
    | 'azureManagedIdentityClientId'
    | 'servicePrincipalSecretRef'
    | 'aadAccessTokenSecretRef'
    | 'clientCertificatePath'
    | 'certificateStore'
    | 'certificateThumbprint'
    | 'certificatePasswordSecretRef'
  >,
): SqlServerAuthSupport {
  const mode = options?.authenticationMode ?? 'sql-server'
  if (mode === 'sql-server' || mode === 'windows' || mode === 'azure-ad-interactive') {
    return { live: true, evidence: 'live' }
  }

  return {
    live: false,
    evidence: 'plan-only',
    disabledReason: sqlServerAuthDisabledReason(mode, options),
  }
}

export function sqlServerAuthDisabledReason(
  mode: SqlServerAuthenticationMode,
  options?: Pick<
    SqlServerConnectionOptions,
    | 'azureTenantId'
    | 'azureClientId'
    | 'azureManagedIdentityClientId'
    | 'servicePrincipalSecretRef'
    | 'aadAccessTokenSecretRef'
    | 'clientCertificatePath'
    | 'certificateStore'
    | 'certificateThumbprint'
    | 'certificatePasswordSecretRef'
  >,
) {
  switch (mode) {
    case 'windows':
      return 'Windows current-account authentication requires the Windows desktop application and a configured Windows-authentication server. Choose a supported authentication method in the connection editor.'
    case 'azure-ad-password':
      return options?.aadAccessTokenSecretRef
        ? 'Microsoft Entra password mode has a stored token reference, but live token exchange is not wired to the SQL Server driver yet. Choose a supported authentication method in the connection editor.'
        : 'Microsoft Entra password mode needs a token-acquisition runtime before live execution. Choose Microsoft Entra browser sign-in instead.'
    case 'azure-ad-integrated':
      return 'Microsoft Entra integrated authentication needs OS account token broker support that is not wired to the SQL Server driver yet. Choose a supported authentication method in the connection editor.'
    case 'azure-ad-interactive':
      return 'Microsoft Entra browser sign-in requires an organisation-owned public-client registration in the desktop connection editor. Choose a supported authentication method in the connection editor.'
    case 'azure-ad-managed-identity':
      return options?.azureManagedIdentityClientId
        ? 'Managed identity client id is saved, but DataPad++ has not wired the Azure managed identity token endpoint into SQL Server live connections yet.'
        : 'Managed identity authentication needs an Azure managed identity token endpoint and optional client id before SQL Server live connections can use it.'
    case 'azure-ad-service-principal':
      if (!options?.azureTenantId || !options.azureClientId || !options.servicePrincipalSecretRef) {
        return 'Service principal authentication needs tenant id, client id, and a stored client-secret reference before it can be promoted from plan-only.'
      }
      return 'Service principal metadata is complete, but token exchange is not wired to the SQL Server driver yet. Choose a supported authentication method in the connection editor.'
    case 'certificate':
      if (
        !options?.clientCertificatePath &&
        !options?.certificateStore &&
        !options?.certificateThumbprint
      ) {
        return 'Certificate authentication needs a client certificate path or certificate store/thumbprint before it can be promoted from plan-only.'
      }
      return options.certificatePasswordSecretRef
        ? 'Certificate metadata and password reference are saved, but certificate-based SQL Server authentication is not wired to the current TDS runtime yet.'
        : 'Certificate metadata is saved, but certificate-based SQL Server authentication is not wired to the current TDS runtime yet.'
    default:
      return 'This SQL Server authentication mode is saved in the profile, but live execution is disabled until an adapter-specific runtime path is configured.'
  }
}
