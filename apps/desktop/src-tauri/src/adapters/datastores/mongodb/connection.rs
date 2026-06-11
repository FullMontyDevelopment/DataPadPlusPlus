use std::time::Duration;

use mongodb::{bson::doc, options::ClientOptions, Client as MongoClient};
use serde_json::Value;

use super::super::super::*;

const DEFAULT_MONGODB_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) async fn mongodb_client(
    connection: &ResolvedConnectionProfile,
) -> Result<MongoClient, CommandError> {
    let uri = mongodb_uri(connection);

    crate::infrastructure::log_breadcrumb(
        "mongodb-client",
        format!(
            "parse-options-start id={} host={} database={} connectionString={}",
            connection.id,
            connection.host,
            connection.database.as_deref().unwrap_or(""),
            connection.connection_string.is_some()
        ),
    );
    let mut options = ClientOptions::parse(uri).await?;
    crate::infrastructure::log_breadcrumb(
        "mongodb-client",
        format!("parse-options-complete id={}", connection.id),
    );
    options.server_selection_timeout = Some(DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT);
    options.connect_timeout = Some(DEFAULT_MONGODB_CONNECT_TIMEOUT);

    let client = MongoClient::with_options(options)?;
    crate::infrastructure::log_breadcrumb(
        "mongodb-client",
        format!("client-created id={}", connection.id),
    );
    Ok(client)
}

pub(super) async fn test_mongodb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let client = mongodb_client(connection).await?;
    let database_name = mongodb_database_name(connection);
    crate::infrastructure::log_breadcrumb(
        "mongodb-test",
        format!("ping-start id={} database={database_name}", connection.id),
    );
    let _ = client
        .database(&database_name)
        .run_command(doc! {"ping": 1})
        .await?;
    crate::infrastructure::log_breadcrumb(
        "mongodb-test",
        format!(
            "ping-complete id={} database={database_name}",
            connection.id
        ),
    );

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: Some(database_name),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn mongodb_database_name(connection: &ResolvedConnectionProfile) -> String {
    mongodb_selected_database_name(connection).unwrap_or_else(|| "admin".into())
}

pub(super) fn mongodb_selected_database_name(
    connection: &ResolvedConnectionProfile,
) -> Option<String> {
    connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            connection
                .connection_string
                .as_deref()
                .and_then(mongodb_database_name_from_uri)
        })
}

pub(super) struct MongoDatabaseResolution {
    pub database_name: String,
    pub notice: Option<QueryExecutionNotice>,
}

pub(super) async fn mongodb_database_name_for_collection_query(
    _client: &MongoClient,
    connection: &ResolvedConnectionProfile,
    input: &Value,
    collection_name: &str,
) -> Result<MongoDatabaseResolution, CommandError> {
    let Some((database_name, _explicit_database)) =
        mongodb_database_name_from_query(input, connection)
    else {
        return Err(CommandError::new(
            "mongodb-query-database-required",
            format!(
                "MongoDB collection query for `{collection_name}` needs a database. Select a database in the connection, open the query from a database-scoped object, or add a `database` field to the query."
            ),
        ));
    };

    Ok(MongoDatabaseResolution {
        database_name,
        notice: None,
    })
}

pub(super) fn mongodb_database_name_from_query(
    input: &Value,
    connection: &ResolvedConnectionProfile,
) -> Option<(String, bool)> {
    input
        .get("database")
        .or_else(|| input.get("db"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| (value.to_string(), true))
        .or_else(|| mongodb_selected_database_name(connection).map(|database| (database, false)))
}

pub(super) fn mongodb_database_name_from_command(
    input: &Value,
    connection: &ResolvedConnectionProfile,
) -> String {
    mongodb_database_name_from_query(input, connection)
        .map(|(database, _)| database)
        .unwrap_or_else(|| mongodb_database_name(connection))
}

fn mongodb_uri(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        let has_credentials = connection.username.is_some();
        let credentials = match (&connection.username, &connection.password) {
            (Some(username), Some(password)) => format!(
                "{}:{}@",
                percent_encode_uri_component(username),
                percent_encode_uri_component(password)
            ),
            (Some(username), None) => format!("{}@", percent_encode_uri_component(username)),
            _ => String::new(),
        };

        let database = mongodb_database_name(connection);
        let auth_source = if has_credentials && database != "admin" {
            "?authSource=admin"
        } else {
            ""
        };

        format!(
            "mongodb://{}{host}:{port}/{database}{auth_source}",
            credentials,
            host = connection.host,
            port = connection.port.unwrap_or(27017)
        )
    })
}

fn percent_encode_uri_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn mongodb_database_name_from_uri(uri: &str) -> Option<String> {
    let after_scheme = uri.split_once("://").map_or(uri, |(_, rest)| rest);
    let (_, path_and_options) = after_scheme.split_once('/')?;
    let database = path_and_options
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim();

    if database.is_empty() {
        None
    } else {
        Some(database.to_string())
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/connection_tests.rs"]
mod connection_tests;
