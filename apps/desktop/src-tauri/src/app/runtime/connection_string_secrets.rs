use crate::{
    domain::{
        error::CommandError,
        models::{ConnectionStringSecretBinding, SecretRef},
    },
    security,
};

pub(super) fn connection_string_secret_ref(
    connection_id: &str,
    connection_name: &str,
) -> SecretRef {
    let id = super::generate_id("connection-string");
    SecretRef {
        id: id.clone(),
        provider: "desktop-secret-store".into(),
        service: "DataPadPlusPlus".into(),
        account: format!("connection-string:{connection_id}:{id}"),
        label: format!("{connection_name} connection string"),
    }
}

/// Compatibility resolver for schema <= 11 component bindings. New connection
/// strings are stored and resolved as one opaque vault value.
pub(super) fn resolve_legacy_connection_string_secrets(
    value: &str,
    bindings: &[ConnectionStringSecretBinding],
) -> Result<String, CommandError> {
    let mut resolved = value.to_string();
    for binding in bindings {
        let mut secret = security::resolve_secret_value(&binding.secret_ref).map_err(|_| {
            CommandError::new(
                "connection-string-secret-missing",
                format!(
                    "Re-enter {} before using this connection.",
                    binding.secret_ref.label
                ),
            )
        })?;
        let result = match binding.encoding_strategy.as_str() {
            // Schema 11 already persisted the exact placeholder in the complete
            // provider string. Replacing that token directly is both lossless
            // and compatible with URI forms that generic URL parsers reject
            // (for example MongoDB seed lists and Oracle descriptors).
            "uri-password" | "uri-query" => replace_legacy_placeholder(
                &resolved,
                &binding.placeholder,
                &url::form_urlencoded::byte_serialize(secret.as_bytes()).collect::<String>(),
            ),
            "raw" => replace_legacy_placeholder(&resolved, &binding.placeholder, &secret),
            _ => Err(CommandError::new(
                "connection-string-secret-binding-invalid",
                "Connection string credential binding is unsupported.",
            )),
        };
        secret.clear();
        resolved = result?;
    }
    Ok(resolved)
}

fn replace_legacy_placeholder(
    value: &str,
    placeholder: &str,
    secret: &str,
) -> Result<String, CommandError> {
    if value.matches(placeholder).count() != 1 {
        return Err(invalid_binding());
    }
    Ok(value.replacen(placeholder, secret, 1))
}

fn invalid_binding() -> CommandError {
    CommandError::new(
        "connection-string-secret-binding-invalid",
        "A stored connection string credential binding no longer matches the connection string. Re-enter the connection credentials.",
    )
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/connection_string_secrets_tests.rs"]
mod tests;
