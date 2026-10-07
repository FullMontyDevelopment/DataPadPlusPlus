# DataPad++ Windows Negotiate patch

Runtime source imported from crates.io `tiberius 0.12.3`, archive SHA-256
`a1446cb4198848d1562301a3340424b4f425ef79f35ef9ee034769a9dd92c10d`.
Upstream MIT/Apache-2.0 licenses and the original manifest are retained.

Upstream `AuthMethod::Integrated` used the `winauth` NTLM-only provider and a
fixed two-message exchange. It could not negotiate Kerberos in domains that
restrict NTLM. The application's SQL-login and Entra token paths are unchanged.

## Patch boundary

- `src/client/windows_sspi.rs`: current-account native SSPI **Negotiate**, safe
  handle ownership, bounded output, multi-round completion, TLS endpoint channel
  bindings and short-name DNS expansion with `AI_FQDN`. No reverse-DNS guessing,
  credential cache, passwords, delegation request, interactive login, or explicit
  NTLM retry. Windows/domain policy determines the selected mechanism.
- `src/client/windows_login.rs`: bounded handshake and success invariants.
- `src/client/connection.rs`: only Integrated login uses the new exchange;
  LOGIN7 carries the first token, subsequent client messages use TDS type 0x11,
  final server tokens are processed before requiring both LOGINACK and DONE.
  Debug output exposes buffer length, not contents.
- `src/client.rs`: registers these internal modules.
- `src/tds/codec/token/token_sspi.rs` and `src/tds/codec/login.rs`: debug output
  never dumps login credentials or token bytes. SSPI-owned buffers and temporary
  challenge copies are zeroized when released (transport buffers remain managed
  by the existing TLS/TDS layers).
- `src/client/windows_login_wire_tests.rs`: deterministic mock-wire tests.
- `Cargo.toml`: adds Windows API bindings and zeroize; removes unused upstream integration
  test/example dev dependencies and targets (those files are not vendored).
  Production dependencies/features otherwise remain upstream-compatible.
  Explicit Clippy allowances cover existing upstream representation/style lints
  previously excluded for registry dependencies; new Windows modules deny all
  Clippy warnings. Do not extend this baseline to silence new patch warnings.

The application passes the actual connected TCP port into the driver's config
after SQL Browser resolution. A single shared SQL Server connection path applies
this to tests, queries, Explorer, metadata, editing and transfer operations.

## Maintenance and verification

The application manifest patches crates.io and makes this library a workspace
member so tests share the application lockfile. Default workspace commands still
target the application. Optional upstream library features add lockfile entries;
they are not automatically enabled or shipped in the application.

```sh
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p tiberius --lib --locked
```

Windows CI tests native credential acquisition without network authentication.
Linux CI tests platform independence, the protocol state machine and wire path.
Neither substitutes for a live domain/Kerberos/Extended Protection acceptance
test. See the [application authentication guide](../../../../../docs/sqlserver-authentication.md).

When updating Tiberius, diff these files against upstream, retain licenses,
reapply only required changes, and rerun driver/application tests plus SQL-login
fixtures and live domain acceptance. Remove this patch only after upstream
provides equivalent Negotiate, continuation, final-token and channel-binding
support. Do not silently revert to NTLM-only Integrated authentication.
