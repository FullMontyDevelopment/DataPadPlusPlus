# SQL Server Windows login and Microsoft Entra

DataPad++ is pre-release software. Validate this feature with disposable or read-only databases before relying on it. The implementation is available, but real Windows-domain and cross-platform Azure SQL/MFA acceptance testing is still required.

## Choose an authentication method

Create or edit a **SQL Server** connection. Authentication is shown in the main connection flow, independently of TCP, named-instance, Azure SQL, or connection-string transport.

| Method | Platforms | Requirements |
| --- | --- | --- |
| SQL Server login | Windows, macOS, Linux | Existing SQL username/password support |
| Windows — current account | Windows only | SQL Server configured for Windows authentication; the current process account must have database access |
| Microsoft Entra — browser sign-in | Windows, macOS, Linux | Public Azure tenant, organisation-owned public-client registration, consent, and an Entra-enabled target |

Saving a profile does not connect to a database. Sign-in is not evidence that database permissions or connectivity work: use **Test connection** separately. Saving preserves a completed sign-in only for the same connection, environment, tenant and application. Pending sign-ins are canceled by profile changes; changing the authentication binding or environment requires signing in again. Startup, Explorer, queries, API Server and MCP never open a browser automatically.

## Windows current account

1. Configure TCP or a named instance reachable from this Windows machine.
2. Choose **Windows — current account**. The displayed account is the account running DataPad++, including when launched through Run as another user.
3. Ensure the SQL Server administrator has granted that Windows user or group a login and database permissions. Domain trust, DNS and Kerberos service principal names must be configured by your administrator as appropriate.
4. Test the connection. DataPad++ never asks for or stores a Windows password.

This is not Microsoft Entra Integrated authentication. Azure SQL Database does not universally accept this Windows login mode. Azure SQL Managed Instance's additional Windows/Kerberos support has separate infrastructure prerequisites; see [Microsoft's setup guidance](https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/winauth-azuread-setup?view=azuresql).

## Register your organisation's Entra application

An administrator must create or approve a Microsoft Entra app registration for this desktop client:

1. Use your organisation's tenant; obtain its **Directory (tenant) ID** and the registration's **Application (client) ID**. DataPad++ accepts GUIDs, not `common` or `organizations` authorities.
2. Under Authentication, add the **Mobile and desktop applications** platform and the `http://localhost` redirect URI. This is a public client using the system browser; do not create or enter a client secret.
3. Add the **Azure SQL Database → Delegated → user_impersonation** permission and obtain consent according to tenant policy. DataPad++ requests `https://database.windows.net/.default`.
4. Configure an Entra administrator on the database service and grant the selected user/group the required database permissions, normally using a contained external user. Specify the intended database; permission in one database does not imply access to `master`.

See Microsoft's [system-browser guidance](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/using-web-browsers) and [SQL authentication guidance](https://learn.microsoft.com/en-us/sql/connect/ado-net/sql/azure-active-directory-authentication?view=sql-server-ver17).

## Sign in

Enter tenant/client IDs, select **Microsoft Entra — browser sign-in**, then choose **Sign in**. Complete account selection and MFA in your system browser. The application waits up to five minutes. Use **Cancel sign-in** to stop; closing the browser alone may not notify the app immediately.

**Remember this account on this device** is unchecked by default. Session-only tokens remain in the authentication helper's memory. Remembered sessions use MSAL's protected OS cache: Windows protection APIs, macOS Keychain, or Linux Secret Service/libsecret. Linux requires an unlocked keyring and the libsecret runtime library. If protected storage is unavailable, uncheck Remember and retry; there is no plaintext fallback. See [MSAL cache guidance](https://learn.microsoft.com/en-us/entra/msal/dotnet/how-to/token-cache-serialization).

Accounts are isolated by workspace, connection, environment, tenant and application. A private cache contains only the explicitly selected account. **Change account** opens the browser's account selector. **Sign out** clears this binding's account, not unrelated Microsoft accounts or browser cookies. If a locked OS keyring prevents removal, restoration is disabled and a warning asks you to unlock the keyring and sign out again to remove the old encrypted cache. Session-only sign-in remains available. Locking or switching workspaces cancels pending requests and clears in-memory helper sessions. Remembered caches remain protected on this device and are never included in workspace exports or backups.

Before opening a new database session, the helper silently acquires/renews a token. If consent, MFA or another interaction is necessary, the operation returns **Sign-in required**. No already-submitted query or write is automatically retried.

## Connection strings and TLS

The complete saved connection string remains unchanged in the OS vault. Runtime parsing recognises `Integrated Security=true`, `IntegratedSecurity=SSPI`, and `Trusted_Connection=yes` for Windows, and `Authentication=Active Directory Interactive` for Entra. Explicit profile and connection-string authentication settings must agree. Remove `User ID`/`UID` and `Password`/`PWD` for Windows current-account or Entra browser authentication. Unsupported authentication methods are rejected, never silently converted to SQL login.

Entra requires encryption and certificate validation. `Encrypt=false`, `DANGER_PLAINTEXT` and `TrustServerCertificate=true` are rejected. Use a trusted server certificate or an explicitly configured CA certificate. For certificate failures, correct DNS/hostname, expiry or the trust chain; do not disable validation. A validated public Azure SQL gateway may redirect login before any command is submitted; query execution is not replayed.

## Troubleshooting and limits

- **Sign-in required:** open the connection editor and sign in for the correct environment. A cached account does not guarantee consent or database access remains valid.
- **Secure storage unavailable:** unlock the OS keyring or use session-only sign-in.
- **Microsoft sign-in rejected:** verify tenant/client IDs, localhost redirect, delegated permission and administrator consent. Ask the administrator to inspect Entra sign-in logs for Conditional Access failures.
- **MFA succeeds but database access fails:** verify the selected database, network/firewall access, external user/group membership and database permissions.
- **Broker-required policy:** device-compliance policies requiring WAM or another OS broker are outside this release. Do not weaken organisation policies to bypass this limitation.
- Not supported: Entra Integrated/WAM, cross-platform Kerberos, alternate Windows credentials, device-code sign-in, service principals, client certificates, managed identities and sovereign clouds.

## Developer validation

`npm run auth:sidecar:test` publishes and exercises the private helper protocol without an identity provider. Native unit tests cover mode selection, aliases, conflicts, strict TLS and platform gating. Release packaging includes the helper on Windows x64, Linux x64 and macOS Apple Silicon; SQL execution remains in Rust/Tiberius.

macOS signing includes the JIT entitlement required by the bundled .NET runtime, without debugger or library-validation bypass entitlements. The release workflow smoke-tests the helper inside the resulting app bundle as well as verifying its signature. See [Microsoft's macOS deployment requirements](https://learn.microsoft.com/en-us/dotnet/core/deploying/macos).

Before release, independently verify Windows-domain SQL Server, real Azure SQL MFA on all three operating systems, remembered sign-in after restart, locked/unavailable keyrings, revoked consent, concurrent windows, cancellation and account changes. Hosted CI and the SQL-password Docker fixture cannot prove those identity flows.
