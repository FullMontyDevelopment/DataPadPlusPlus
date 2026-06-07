use std::time::Duration;

use mongodb::{options::ClientOptions, Client as MongoClient, Database};
use serde_json::Value;

use super::super::super::*;

const DEFAULT_MONGODB_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(15);

pub(super) async fn mongodb_client(
    connection: &ResolvedConnectionProfile,
) -> Result<MongoClient, CommandError> {
    let uri = mongodb_uri(connection);

    let mut options = ClientOptions::parse(uri).await?;
    options.server_selection_timeout = Some(DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT);
    options.connect_timeout = Some(DEFAULT_MONGODB_CONNECT_TIMEOUT);

    Ok(MongoClient::with_options(options)?)
}

pub(super) async fn test_mongodb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let client = mongodb_client(connection).await?;
    let _ = client.list_database_names().await?;
    let database_name = mongodb_database_name(connection);

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
    client: &MongoClient,
    connection: &ResolvedConnectionProfile,
    input: &Value,
    collection_name: &str,
) -> MongoDatabaseResolution {
    let (database_name, explicit_database) = mongodb_database_name_from_query(input, connection);

    if explicit_database || database_name != "admin" {
        return MongoDatabaseResolution {
            database_name,
            notice: None,
        };
    }

    if database_has_collection(&client.database(&database_name), collection_name).await {
        return MongoDatabaseResolution {
            database_name,
            notice: None,
        };
    }

    if let Some(discovered_database) =
        discover_database_for_collection(client, collection_name).await
    {
        return MongoDatabaseResolution {
            notice: Some(QueryExecutionNotice {
                code: "mongodb-database-auto-selected".into(),
                level: "info".into(),
                message: format!(
                    "MongoDB query used database `{discovered_database}` because collection `{collection_name}` was not found in `admin`. Set the connection database or add a `database` field to the query to make this explicit."
                ),
            }),
            database_name: discovered_database,
        };
    }

    MongoDatabaseResolution {
        database_name,
        notice: None,
    }
}

pub(super) fn mongodb_database_name_from_query(
    input: &Value,
    connection: &ResolvedConnectionProfile,
) -> (String, bool) {
    input
        .get("database")
        .or_else(|| input.get("db"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| (value.to_string(), true))
        .unwrap_or_else(|| (mongodb_database_name(connection), false))
}

async fn database_has_collection(database: &Database, collection_name: &str) -> bool {
    database
        .list_collection_names()
        .await
        .map(|collections| collections.iter().any(|name| name == collection_name))
        .unwrap_or(false)
}

async fn discover_database_for_collection(
    client: &MongoClient,
    collection_name: &str,
) -> Option<String> {
    let database_names = client.list_database_names().await.ok()?;

    for database_name in database_names {
        if matches!(database_name.as_str(), "admin" | "config" | "local") {
            continue;
        }

        if database_has_collection(&client.database(&database_name), collection_name).await {
            return Some(database_name);
        }
    }

    None
}

fn mongodb_uri(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        let has_credentials = connection.username.is_some();
        let credentials = match (&connection.username, &connection.password) {
            (Some(username), Some(password)) => format!("{username}:{password}@"),
            (Some(username), None) => format!("{username}@"),
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
mod tests {
    use super::*;

    #[test]
    fn mongodb_uri_uses_admin_auth_source_for_database_connections() {
        let connection = resolved_connection(Some("catalog"));

        assert_eq!(
            mongodb_uri(&connection),
            "mongodb://datapadplusplus:datapadplusplus@localhost:27018/catalog?authSource=admin"
        );
    }

    #[test]
    fn mongodb_uri_does_not_append_auth_source_to_connection_strings() {
        let mut connection = resolved_connection(Some("catalog"));
        connection.connection_string =
            Some("mongodb://user:secret@localhost:27018/catalog?authSource=app".into());

        assert_eq!(
            mongodb_uri(&connection),
            "mongodb://user:secret@localhost:27018/catalog?authSource=app"
        );
    }

    #[test]
    fn mongodb_uri_uses_admin_database_without_extra_auth_source() {
        let connection = resolved_connection(Some("admin"));

        assert_eq!(
            mongodb_uri(&connection),
            "mongodb://datapadplusplus:datapadplusplus@localhost:27018/admin"
        );
    }

    #[test]
    fn mongodb_uri_treats_empty_database_as_admin() {
        let connection = resolved_connection(Some(""));

        assert_eq!(
            mongodb_uri(&connection),
            "mongodb://datapadplusplus:datapadplusplus@localhost:27018/admin"
        );
    }

    #[test]
    fn mongodb_database_name_uses_connection_string_database_when_profile_database_is_empty() {
        let mut connection = resolved_connection(Some(""));
        connection.connection_string =
            Some("mongodb://user:secret@localhost:27018/catalog?authSource=admin".into());

        assert_eq!(mongodb_database_name(&connection), "catalog");
    }

    #[test]
    fn mongodb_database_name_ignores_empty_connection_string_path() {
        let mut connection = resolved_connection(None);
        connection.connection_string = Some("mongodb://localhost:27018/?authSource=admin".into());

        assert_eq!(mongodb_database_name(&connection), "admin");
    }

    #[test]
    fn mongodb_database_name_from_query_prefers_explicit_database_field() {
        let connection = resolved_connection(Some("admin"));
        let input = serde_json::json!({
            "database": "catalog",
            "collection": "products",
            "filter": {}
        });

        assert_eq!(
            mongodb_database_name_from_query(&input, &connection),
            ("catalog".into(), true)
        );
    }

    #[test]
    fn mongodb_database_name_from_query_falls_back_to_connection_database() {
        let connection = resolved_connection(Some("catalog"));
        let input = serde_json::json!({
            "collection": "products",
            "filter": {}
        });

        assert_eq!(
            mongodb_database_name_from_query(&input, &connection),
            ("catalog".into(), false)
        );
    }

    fn resolved_connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-mongo".into(),
            name: "Fixture MongoDB".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            host: "localhost".into(),
            port: Some(27018),
            database: database.map(str::to_string),
            username: Some("datapadplusplus".into()),
            password: Some("datapadplusplus".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}
