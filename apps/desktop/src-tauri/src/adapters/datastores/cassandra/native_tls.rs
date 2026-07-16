use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;

use super::super::super::*;

pub(super) fn cassandra_tls_config(
    connection: &ResolvedConnectionProfile,
) -> Result<Option<Arc<rustls::ClientConfig>>, CommandError> {
    let Some(options) = connection.cassandra_options.as_ref() else {
        return Ok(None);
    };
    let use_tls = options.use_tls.unwrap_or(false)
        || options.ca_certificate_path.is_some()
        || options.client_certificate_path.is_some()
        || options.client_key_path.is_some();
    if !use_tls {
        return Ok(None);
    }

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Some(path) = non_empty_path(options.ca_certificate_path.as_deref()) {
        let mut reader = BufReader::new(File::open(path).map_err(|error| {
            CommandError::new(
                "cassandra-ca-certificate-unreadable",
                format!("The Cassandra CA certificate could not be read: {error}"),
            )
        })?);
        let certificates = rustls_pemfile::certs(&mut reader)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                CommandError::new(
                    "cassandra-ca-certificate-invalid",
                    format!("The Cassandra CA certificate is invalid: {error}"),
                )
            })?;
        if certificates.is_empty() {
            return Err(CommandError::new(
                "cassandra-ca-certificate-invalid",
                "The Cassandra CA certificate did not contain a PEM certificate.",
            ));
        }
        roots.add_parsable_certificates(certificates);
    }

    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| {
            CommandError::new(
                "cassandra-tls-config-invalid",
                format!("The Cassandra TLS configuration is invalid: {error}"),
            )
        })?
        .with_root_certificates(roots);
    let config = match (
        non_empty_path(options.client_certificate_path.as_deref()),
        non_empty_path(options.client_key_path.as_deref()),
    ) {
        (None, None) => builder.with_no_client_auth(),
        (Some(certificate_path), Some(key_path)) => {
            client_authenticated_config(builder, certificate_path, key_path)?
        }
        (Some(_), None) => {
            return Err(CommandError::new(
                "cassandra-client-key-missing",
                "A Cassandra client certificate requires a matching client key.",
            ));
        }
        (None, Some(_)) => {
            return Err(CommandError::new(
                "cassandra-client-certificate-missing",
                "A Cassandra client key requires a matching client certificate.",
            ));
        }
    };
    Ok(Some(Arc::new(config)))
}

fn client_authenticated_config(
    builder: rustls::ConfigBuilder<rustls::ClientConfig, rustls::client::WantsClientCert>,
    certificate_path: &str,
    key_path: &str,
) -> Result<rustls::ClientConfig, CommandError> {
    let mut certificate_reader = BufReader::new(File::open(certificate_path).map_err(|error| {
        CommandError::new(
            "cassandra-client-certificate-unreadable",
            format!("The Cassandra client certificate could not be read: {error}"),
        )
    })?);
    let certificates = rustls_pemfile::certs(&mut certificate_reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            CommandError::new(
                "cassandra-client-certificate-invalid",
                format!("The Cassandra client certificate is invalid: {error}"),
            )
        })?;
    let mut key_reader = BufReader::new(File::open(key_path).map_err(|error| {
        CommandError::new(
            "cassandra-client-key-unreadable",
            format!("The Cassandra client key could not be read: {error}"),
        )
    })?);
    let key = rustls_pemfile::private_key(&mut key_reader)
        .map_err(|error| {
            CommandError::new(
                "cassandra-client-key-invalid",
                format!("The Cassandra client key is invalid: {error}"),
            )
        })?
        .ok_or_else(|| {
            CommandError::new(
                "cassandra-client-key-invalid",
                "The Cassandra client key did not contain a supported PEM key.",
            )
        })?;
    builder
        .with_client_auth_cert(certificates, key)
        .map_err(|error| {
            CommandError::new(
                "cassandra-client-identity-invalid",
                format!("The Cassandra client certificate and key do not match: {error}"),
            )
        })
}

fn non_empty_path(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}
