use sqlx::{
    types::chrono::{NaiveDate, NaiveDateTime, NaiveTime},
    Column, Row, TypeInfo,
};

use super::super::super::*;

pub(super) fn stringify_mysql_cell(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    stringify_sqlx_common(
        [
            row.try_get::<Option<String>, _>(index).ok().flatten(),
            row.try_get::<Option<NaiveDateTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date_time),
            row.try_get::<Option<NaiveDate>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date),
            row.try_get::<Option<NaiveTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_time),
            row.try_get::<Option<bool>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i32>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<f64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|item| format!("<{} bytes>", item.len())),
        ],
        format!("<{}>", row.columns()[index].type_info().name()),
    )
}

fn stringify_sqlx_common<const N: usize>(
    candidates: [Option<String>; N],
    fallback: String,
) -> String {
    candidates.into_iter().flatten().next().unwrap_or(fallback)
}

pub(super) fn mysql_dsn(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        let username = percent_encode_mysql_uri_component(
            &connection.username.clone().unwrap_or_else(|| "root".into()),
        );
        let password =
            percent_encode_mysql_uri_component(&connection.password.clone().unwrap_or_default());
        let database =
            percent_encode_mysql_uri_component(&connection.database.clone().unwrap_or_default());
        format!(
            "mysql://{}:{}@{}:{}/{}",
            username,
            password,
            connection.host,
            connection.port.unwrap_or(3306),
            database
        )
    })
}

fn percent_encode_mysql_uri_component(value: &str) -> String {
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

pub(super) async fn test_mysql_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
    let _: i64 = sqlx::query_scalar("select 1").fetch_one(&pool).await?;
    pool.close().await;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mysql_dsn_percent_encodes_credentials_and_database() {
        let connection = ResolvedConnectionProfile {
            id: "conn".into(),
            name: "MySQL".into(),
            engine: "mysql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(3306),
            database: Some("qa data".into()),
            username: Some("user@example.com".into()),
            password: Some("p@ss:word/1".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
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
        };

        assert_eq!(
            mysql_dsn(&connection),
            "mysql://user%40example.com:p%40ss%3Aword%2F1@localhost:3306/qa%20data"
        );
    }

    #[test]
    fn explicit_mysql_connection_string_is_preserved() {
        let mut connection = ResolvedConnectionProfile {
            id: "conn".into(),
            name: "MySQL".into(),
            engine: "mysql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(3306),
            database: Some("app".into()),
            username: Some("root".into()),
            password: Some("secret".into()),
            connection_string: Some("mysql://custom".into()),
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
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
        };

        assert_eq!(mysql_dsn(&connection), "mysql://custom");
        connection.connection_string = None;
        assert!(mysql_dsn(&connection).starts_with("mysql://root:secret@"));
    }
}
