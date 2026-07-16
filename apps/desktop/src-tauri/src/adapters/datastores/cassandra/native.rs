use std::net::SocketAddr;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;
use scylla::client::Compression;
use scylla::errors::TranslationError;
use scylla::policies::address_translator::{AddressTranslator, UntranslatedPeer};
use scylla::response::PagingState;
use scylla::statement::unprepared::Statement;
use scylla::statement::{Consistency, SerialConsistency};
use scylla::value::{CqlValue, Row};
use serde_json::{json, Map, Number, Value};

use super::super::super::*;
use super::connection::{cassandra_contact_points, configured_cassandra_keyspace};
use super::native_tls::cassandra_tls_config;
use crate::domain::error::redact_sensitive_text;

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;

pub(super) async fn connect_cassandra(
    connection: &ResolvedConnectionProfile,
) -> Result<Session, CommandError> {
    validate_cassandra_runtime_options(connection)?;
    let options = connection.cassandra_options.as_ref();
    let contact_points = cassandra_contact_points(connection);
    let mut builder = SessionBuilder::new().known_nodes(&contact_points);
    if let Some(target) = local_single_contact_point(&contact_points) {
        builder = builder.address_translator(Arc::new(SingleContactPointTranslator { target }));
    }

    if let Some(keyspace) = configured_cassandra_keyspace(connection) {
        builder = builder.use_keyspace(keyspace, false);
    }
    if let Some(datacenter) = options
        .and_then(|value| value.local_datacenter.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.prefer_datacenter(datacenter.to_string());
    }
    if let Some(username) = connection
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let password = connection.password.as_deref().ok_or_else(|| {
            CommandError::new(
                "cassandra-password-missing",
                "The Cassandra profile has a username but no resolved password.",
            )
        })?;
        builder = builder.user(username, password);
    }
    builder = builder.compression(cassandra_compression(connection)?);

    if let Some(tls_config) = cassandra_tls_config(connection)? {
        builder = builder.tls_context(Some(tls_config));
    }

    let connect_timeout = options
        .and_then(|value| value.connect_timeout_ms)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
        .max(1);
    builder = builder.connection_timeout(Duration::from_millis(connect_timeout));

    tokio::time::timeout(Duration::from_millis(connect_timeout), builder.build())
        .await
        .map_err(|_| {
            CommandError::new(
                "cassandra-connection-timeout",
                format!(
                    "Cassandra did not accept a native CQL connection within {connect_timeout} ms."
                ),
            )
        })?
        .map_err(|error| cassandra_driver_error(connection, "cassandra-connection-failed", error))
}

struct SingleContactPointTranslator {
    target: SocketAddr,
}

#[async_trait]
impl AddressTranslator for SingleContactPointTranslator {
    async fn translate_address(
        &self,
        _untranslated_peer: &UntranslatedPeer,
    ) -> Result<SocketAddr, TranslationError> {
        Ok(self.target)
    }
}

fn local_single_contact_point(contact_points: &[String]) -> Option<SocketAddr> {
    let [contact_point] = contact_points else {
        return None;
    };
    let address = contact_point.parse::<SocketAddr>().ok()?;
    address.ip().is_loopback().then_some(address)
}

pub(super) async fn execute_cassandra_statement(
    session: &Session,
    connection: &ResolvedConnectionProfile,
    statement_text: &str,
    row_limit: u32,
    tracing_enabled: bool,
) -> Result<Value, CommandError> {
    let options = connection.cassandra_options.as_ref();
    let fetch_limit = row_limit.saturating_add(1).max(1) as usize;
    let configured_page_size = options
        .and_then(|value| value.page_size)
        .unwrap_or(fetch_limit as u32)
        .max(1);
    let page_size = configured_page_size
        .min(fetch_limit as u32)
        .min(i32::MAX as u32) as i32;
    let mut statement = Statement::new(statement_text);
    statement.set_page_size(page_size);
    statement.set_consistency(cassandra_consistency(connection)?);
    statement.set_serial_consistency(cassandra_serial_consistency(connection)?);
    statement.set_tracing(tracing_enabled);
    statement.set_is_idempotent(true);
    statement.set_request_timeout(Some(Duration::from_millis(
        options
            .and_then(|value| value.request_timeout_ms.or(value.read_timeout_ms))
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)
            .max(1),
    )));

    let mut paging_state = PagingState::start();
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut tracing_ids = Vec::new();
    let has_more_rows = loop {
        let (query_result, paging_response) = session
            .query_single_page(statement.clone(), (), paging_state)
            .await
            .map_err(|error| cassandra_driver_error(connection, "cassandra-query-failed", error))?;
        let rows_result = query_result.into_rows_result().map_err(|error| {
            cassandra_driver_error(connection, "cassandra-response-invalid", error)
        })?;

        if columns.is_empty() {
            columns = rows_result
                .column_specs()
                .as_slice()
                .iter()
                .map(|column| column.name().to_string())
                .collect();
        }
        warnings.extend(rows_result.warnings().map(str::to_string));
        if let Some(tracing_id) = rows_result.tracing_id() {
            tracing_ids.push(tracing_id.to_string());
        }

        let page_row_count = rows_result.rows_num();
        let remaining = fetch_limit.saturating_sub(rows.len());
        for row in rows_result
            .rows::<Row>()
            .map_err(|error| {
                cassandra_driver_error(connection, "cassandra-response-invalid", error)
            })?
            .take(remaining)
        {
            let row = row.map_err(|error| {
                cassandra_driver_error(connection, "cassandra-response-invalid", error)
            })?;
            rows.push(Value::Array(
                row.columns
                    .into_iter()
                    .map(|value| value.map(cql_value_to_json).unwrap_or(Value::Null))
                    .collect(),
            ));
        }

        let page_was_partially_consumed = page_row_count > remaining;
        match paging_response.into_paging_control_flow() {
            ControlFlow::Break(()) => {
                break page_was_partially_consumed;
            }
            ControlFlow::Continue(next_page) if rows.len() < fetch_limit => {
                paging_state = next_page;
            }
            ControlFlow::Continue(_) => {
                break true;
            }
        }
    };

    let mut response = json!({
        "columns": columns,
        "rows": rows,
        "warnings": warnings,
    });
    if !tracing_ids.is_empty() {
        response["tracingIds"] = json!(tracing_ids);
    }
    if has_more_rows || rows.len() > row_limit as usize {
        response["pagingState"] = Value::String("more-results-available".into());
    }
    Ok(response)
}

fn validate_cassandra_runtime_options(
    connection: &ResolvedConnectionProfile,
) -> Result<(), CommandError> {
    let Some(options) = connection.cassandra_options.as_ref() else {
        return Ok(());
    };
    if matches!(
        options.connect_mode.as_deref(),
        Some("secure-connect-bundle")
    ) || options
        .secure_connect_bundle_path
        .as_deref()
        .is_some_and(|path| !path.trim().is_empty())
        || matches!(
            options.auth_provider.as_deref(),
            Some("secure-connect-bundle")
        )
    {
        return Err(CommandError::new(
            "cassandra-secure-connect-bundle-unsupported",
            "Secure Connect Bundle profiles are not supported by the bundled native CQL runtime yet. Configure contact points and TLS certificates instead.",
        ));
    }
    if matches!(options.auth_provider.as_deref(), Some("kerberos")) {
        return Err(CommandError::new(
            "cassandra-kerberos-unsupported",
            "Kerberos authentication is not supported by the bundled native CQL runtime.",
        ));
    }
    if let Some(protocol) = options.protocol_version.as_deref() {
        if protocol != "v4" {
            return Err(CommandError::new(
                "cassandra-protocol-unsupported",
                format!(
                    "The bundled native CQL runtime currently uses protocol v4; the profile requested {protocol}."
                ),
            ));
        }
    }
    if options.certificate_password_secret_ref.is_some() {
        return Err(CommandError::new(
            "cassandra-encrypted-client-key-unsupported",
            "Password-encrypted Cassandra client keys are not supported by the bundled native CQL runtime.",
        ));
    }
    Ok(())
}

fn cassandra_compression(
    connection: &ResolvedConnectionProfile,
) -> Result<Option<Compression>, CommandError> {
    match connection
        .cassandra_options
        .as_ref()
        .and_then(|value| value.compression.as_deref())
        .unwrap_or("none")
    {
        "none" => Ok(None),
        "lz4" => Ok(Some(Compression::Lz4)),
        "snappy" => Ok(Some(Compression::Snappy)),
        value => Err(CommandError::new(
            "cassandra-compression-invalid",
            format!("Unknown Cassandra compression mode: {value}."),
        )),
    }
}

fn cassandra_consistency(
    connection: &ResolvedConnectionProfile,
) -> Result<Consistency, CommandError> {
    match connection
        .cassandra_options
        .as_ref()
        .and_then(|value| value.consistency_level.as_deref())
        .unwrap_or("local-quorum")
    {
        "one" => Ok(Consistency::One),
        "two" => Ok(Consistency::Two),
        "three" => Ok(Consistency::Three),
        "quorum" => Ok(Consistency::Quorum),
        "all" => Ok(Consistency::All),
        "local-quorum" => Ok(Consistency::LocalQuorum),
        "each-quorum" => Ok(Consistency::EachQuorum),
        "local-one" => Ok(Consistency::LocalOne),
        "serial" => Ok(Consistency::Serial),
        "local-serial" => Ok(Consistency::LocalSerial),
        value => Err(CommandError::new(
            "cassandra-consistency-invalid",
            format!("Unknown Cassandra consistency level: {value}."),
        )),
    }
}

fn cassandra_serial_consistency(
    connection: &ResolvedConnectionProfile,
) -> Result<Option<SerialConsistency>, CommandError> {
    match connection
        .cassandra_options
        .as_ref()
        .and_then(|value| value.serial_consistency_level.as_deref())
    {
        None => Ok(None),
        Some("serial") => Ok(Some(SerialConsistency::Serial)),
        Some("local-serial") => Ok(Some(SerialConsistency::LocalSerial)),
        Some(value) => Err(CommandError::new(
            "cassandra-serial-consistency-invalid",
            format!("Cassandra serial consistency must be serial or local-serial, not {value}."),
        )),
    }
}

fn cql_value_to_json(value: CqlValue) -> Value {
    match value {
        CqlValue::Ascii(value) | CqlValue::Text(value) => Value::String(value),
        CqlValue::Boolean(value) => Value::Bool(value),
        CqlValue::Blob(value) => Value::String(BASE64_STANDARD.encode(value)),
        CqlValue::Counter(value) => Value::Number(Number::from(value.0)),
        CqlValue::Decimal(value) => {
            let decimal: bigdecimal::BigDecimal = value.into();
            Value::String(decimal.to_string())
        }
        CqlValue::Double(value) => finite_number(value),
        CqlValue::Float(value) => finite_number(value as f64),
        CqlValue::Int(value) => Value::Number(Number::from(value)),
        CqlValue::BigInt(value) => Value::Number(Number::from(value)),
        CqlValue::SmallInt(value) => Value::Number(Number::from(value)),
        CqlValue::TinyInt(value) => Value::Number(Number::from(value)),
        CqlValue::List(values) | CqlValue::Set(values) | CqlValue::Vector(values) => {
            Value::Array(values.into_iter().map(cql_value_to_json).collect())
        }
        CqlValue::Map(values) => Value::Array(
            values
                .into_iter()
                .map(|(key, value)| {
                    json!({
                        "key": cql_value_to_json(key),
                        "value": cql_value_to_json(value),
                    })
                })
                .collect(),
        ),
        CqlValue::UserDefinedType { fields, .. } => {
            let object = fields
                .into_iter()
                .map(|(name, value)| (name, value.map(cql_value_to_json).unwrap_or(Value::Null)))
                .collect::<Map<_, _>>();
            Value::Object(object)
        }
        CqlValue::Tuple(values) => Value::Array(
            values
                .into_iter()
                .map(|value| value.map(cql_value_to_json).unwrap_or(Value::Null))
                .collect(),
        ),
        CqlValue::Empty => Value::String(String::new()),
        value => Value::String(trim_cql_literal(&value.to_string())),
    }
}

fn finite_number(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

fn trim_cql_literal(value: &str) -> String {
    value
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
        .unwrap_or(value)
        .to_string()
}

fn cassandra_driver_error(
    connection: &ResolvedConnectionProfile,
    code: &str,
    error: impl std::fmt::Display,
) -> CommandError {
    let mut detail = redact_sensitive_text(&error.to_string());
    if let Some(password) = connection
        .password
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        detail = detail.replace(password, "[REDACTED]");
    }
    CommandError::new(
        code,
        format!("The Cassandra native CQL driver returned an error. Details: {detail}"),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cassandra/native_tests.rs"]
mod tests;
