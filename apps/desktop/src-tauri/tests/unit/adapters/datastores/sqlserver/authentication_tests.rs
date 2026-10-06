use super::*;
use crate::domain::models::SqlServerConnectionOptions;

fn profile(mode: Option<&str>, ado: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        engine: "sqlserver".into(),
        connection_string: ado.map(Into::into),
        sqlserver_options: Some(SqlServerConnectionOptions {
            authentication_mode: mode.map(Into::into),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn sql_login_remains_the_default() {
    assert_eq!(
        authentication(&profile(
            None,
            Some("Server=localhost;User Id=sa;Password={a;b}")
        ))
        .unwrap(),
        Authentication::SqlLogin
    );
}

#[test]
fn ado_interactive_aliases_select_entra_without_password_fallback() {
    for auth in ["Active Directory Interactive", "ActiveDirectoryInteractive"] {
        assert_eq!(authentication(&profile(None, Some(&format!("Server=fixture.database.windows.net;Authentication={auth};Encrypt=true;TrustServerCertificate=false")))).unwrap(), Authentication::Entra);
    }
}

#[test]
fn integrated_aliases_are_explicitly_platform_gated() {
    for property in [
        "Integrated Security",
        "IntegratedSecurity",
        "Trusted_Connection",
    ] {
        for value in ["true", "SSPI", "yes"] {
            let result = authentication(&profile(
                None,
                Some(&format!("Server=localhost;{property}={value}")),
            ));
            if cfg!(windows) {
                assert_eq!(result.unwrap(), Authentication::Windows);
            } else {
                assert_eq!(result.unwrap_err().code, "sqlserver-windows-unavailable");
            }
        }
    }
}

#[test]
fn ambiguous_modes_and_alternate_credentials_are_rejected() {
    for (mode, ado) in [
        ("sql-server", "Integrated Security=true"),
        ("windows", "Integrated Security=false"),
        ("windows", "User ID=somebody;Password=do-not-log"),
        (
            "windows",
            "Integrated Security=true;Trusted_Connection=false",
        ),
        ("azure-ad-interactive", "Integrated Security=true"),
        (
            "azure-ad-interactive",
            "Authentication=Active Directory Password",
        ),
        ("azure-ad-interactive", "UID=someone@example.test"),
    ] {
        let error = authentication(&profile(Some(mode), Some(ado))).unwrap_err();
        assert!(!error.message.contains("do-not-log"));
        assert!(!error.message.contains("someone@example.test"));
    }
}

#[test]
fn entra_disallows_insecure_transport_from_both_sources() {
    for ado in [
        "Encrypt=false",
        "Encrypt=DANGER_PLAINTEXT",
        "TrustServerCertificate=true",
        "Trust Server Certificate=yes",
    ] {
        assert!(authentication(&profile(Some("azure-ad-interactive"), Some(ado))).is_err());
    }
    for options in [
        SqlServerConnectionOptions {
            encrypt_connection: Some(false),
            ..Default::default()
        },
        SqlServerConnectionOptions {
            trust_server_certificate: Some(true),
            ..Default::default()
        },
    ] {
        let mut connection = profile(Some("azure-ad-interactive"), None);
        connection.sqlserver_options = Some(SqlServerConnectionOptions {
            authentication_mode: Some("azure-ad-interactive".into()),
            ..options
        });
        assert!(authentication(&connection).is_err());
    }
}

#[test]
fn unsupported_methods_never_fall_back_to_sql_login() {
    for mode in [
        "azure-ad-integrated",
        "azure-ad-password",
        "azure-ad-managed-identity",
        "azure-ad-service-principal",
        "certificate",
        "future-mode",
    ] {
        assert_eq!(
            authentication(&profile(Some(mode), None)).unwrap_err().code,
            "sqlserver-auth-mode-unavailable"
        );
    }
}

#[test]
fn unsupported_token_credentials_and_tls_overrides_are_not_silently_ignored() {
    for property in [
        "Access Token",
        "Client Secret",
        "ClientCertificate",
        "TokenCredential",
    ] {
        let error = authentication(&profile(
            None,
            Some(&format!("Server=localhost;{property}=do-not-log")),
        ))
        .unwrap_err();
        assert_eq!(error.code, "sqlserver-auth-configuration");
        assert!(!error.message.contains("do-not-log"));
    }
    for property in [
        "Host Name In Certificate",
        "Server Certificate",
        "TLSVersion",
        "CertificateValidation",
    ] {
        assert!(authentication(&profile(
            Some("azure-ad-interactive"),
            Some(&format!("Server=localhost;{property}=unsupported"))
        ))
        .is_err());
    }
}
