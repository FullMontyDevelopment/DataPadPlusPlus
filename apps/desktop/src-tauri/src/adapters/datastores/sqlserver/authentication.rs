use crate::domain::{error::CommandError, models::ResolvedConnectionProfile};
use connection_string::AdoNetString;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Authentication {
    SqlLogin,
    Windows,
    Entra,
}

fn invalid(message: &str) -> CommandError {
    CommandError::new("sqlserver-auth-configuration", message)
}

fn parse_mode(mode: &str) -> Result<Authentication, CommandError> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "sql-server" | "sql password" | "sqlpassword" => Ok(Authentication::SqlLogin),
        "windows" => Ok(Authentication::Windows),
        "azure-ad-interactive" | "active directory interactive" | "activedirectoryinteractive" => Ok(Authentication::Entra),
        _ => Err(CommandError::new("sqlserver-auth-mode-unavailable", "This SQL Server authentication method is not supported. Choose SQL Server login, Windows current account (Windows only), or Microsoft Entra browser sign-in. No fallback login was attempted.")),
    }
}

fn boolean(value: &str) -> Result<bool, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" | "sspi" => Ok(true),
        "false" | "no" => Ok(false),
        _ => Err(invalid(
            "Invalid SQL Server authentication or TLS option. Check the connection settings.",
        )),
    }
}

pub(super) fn authentication(
    connection: &ResolvedConnectionProfile,
) -> Result<Authentication, CommandError> {
    let options = connection.sqlserver_options.as_ref();
    let configured = options
        .and_then(|o| o.authentication_mode.as_deref())
        .map(parse_mode)
        .transpose()?;
    let ado = connection
        .connection_string
        .as_deref()
        .map(str::parse::<AdoNetString>)
        .transpose()
        .map_err(|_| {
            invalid(
                "The SQL Server connection string could not be parsed. Check its ADO.NET syntax.",
            )
        })?;
    let mut declared = None;
    let mut integrated = None;
    if let Some(ado) = &ado {
        for (key, value) in ado.iter() {
            let key = key.replace([' ', '_'], "");
            if !value.is_empty()
                && matches!(
                    key.as_str(),
                    "accesstoken" | "clientsecret" | "clientcertificate" | "tokencredential"
                )
            {
                return Err(invalid("Supplied access tokens and application credentials are not supported in SQL Server connection strings. Select Microsoft Entra browser sign-in instead."));
            }
            if key == "authentication" {
                declared = Some(parse_mode(value)?);
            }
            if matches!(key.as_str(), "integratedsecurity" | "trustedconnection") {
                let next = boolean(value)?;
                if integrated.is_some_and(|current| current != next) {
                    return Err(invalid(
                        "Conflicting Integrated Security / Trusted_Connection settings.",
                    ));
                }
                integrated = Some(next);
            }
        }
    }
    if integrated == Some(true) {
        if declared.is_some_and(|mode| mode != Authentication::Windows) {
            return Err(invalid(
                "Integrated Security conflicts with the declared authentication method.",
            ));
        }
        declared = Some(Authentication::Windows);
    }
    if configured.is_some() && declared.is_some() && configured != declared {
        return Err(invalid("The connection string authentication method conflicts with the selected Authentication setting."));
    }
    let mode = configured.or(declared).unwrap_or(Authentication::SqlLogin);
    if let Some(ado) = &ado {
        let trust_all = ado
            .get("trustservercertificate")
            .map(|v| boolean(v))
            .transpose()?
            .unwrap_or(false);
        let string_ca = ado
            .get("trustservercertificateca")
            .is_some_and(|v| !v.is_empty());
        let option_ca = options
            .and_then(|o| o.trust_server_certificate_ca_path.as_deref())
            .is_some_and(|v| !v.trim().is_empty());
        if trust_all && (string_ca || option_ca)
            || string_ca
                && !option_ca
                && mode != Authentication::Entra
                && options
                    .and_then(|o| o.trust_server_certificate)
                    .unwrap_or(false)
        {
            return Err(invalid("A CA certificate cannot be combined with Trust server certificate. Disable the trust bypass explicitly."));
        }
    }
    if mode == Authentication::Windows && integrated == Some(false) {
        return Err(invalid(
            "Windows authentication conflicts with disabled Integrated Security.",
        ));
    }
    if mode != Authentication::SqlLogin {
        if let Some(ado) = &ado {
            if ado.iter().any(|(key, value)| {
                !value.is_empty()
                    && matches!(
                        key.replace(' ', "").as_str(),
                        "password" | "pwd" | "userid" | "uid" | "username" | "user"
                    )
            }) {
                return Err(invalid("Remove User ID and Password from the connection string when using Windows current account or Microsoft Entra browser sign-in."));
            }
        }
    }
    if mode == Authentication::Windows && !cfg!(windows) {
        return Err(CommandError::new("sqlserver-windows-unavailable", "Windows current-account authentication is available only on Windows. Use Microsoft Entra browser sign-in or SQL login on this platform."));
    }
    if mode == Authentication::Entra {
        if options.is_some_and(|o| {
            o.host_name_in_certificate.is_some()
                || o.tls_version.is_some()
                || o.certificate_validation.is_some()
        }) {
            return Err(invalid("Custom certificate-hostname, TLS-version and certificate-validation modes are not supported by this driver. Use the server's certificate hostname and system trust store or a CA file."));
        }
        if options.is_some_and(|o| {
            o.encrypt_connection == Some(false) || o.trust_server_certificate == Some(true)
        }) {
            return Err(invalid("Microsoft Entra requires encryption and certificate validation. Enable encryption and disable Trust server certificate."));
        }
        if let Some(ado) = &ado {
            for (key, value) in ado.iter() {
                let key = key.replace(' ', "");
                if !value.is_empty()
                    && matches!(
                        key.as_str(),
                        "hostnameincertificate"
                            | "servercertificate"
                            | "tlsversion"
                            | "certificatevalidation"
                    )
                {
                    return Err(invalid("This connection-string certificate or TLS override is not supported by the driver. Use the server's certificate hostname and system trust store or a CA file."));
                }
                if (key == "encrypt" && !boolean(value)?)
                    || (key == "trustservercertificate" && boolean(value)?)
                {
                    return Err(invalid("Microsoft Entra connection strings must enable encryption and certificate validation."));
                }
            }
        }
    }
    Ok(mode)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/authentication_tests.rs"]
mod tests;
