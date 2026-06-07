use super::super::super::*;
use crate::domain::models::PostgresConnectionOptions;

pub(crate) fn postgres_dsn(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        let default_port = if connection.engine == "cockroachdb" {
            26257
        } else {
            5432
        };
        let default_database = if connection.engine == "cockroachdb" {
            "defaultdb"
        } else {
            "postgres"
        };
        format!(
            "postgres://{}:{}@{}:{}/{}{}",
            connection
                .username
                .clone()
                .unwrap_or_else(|| "postgres".into()),
            connection.password.clone().unwrap_or_default(),
            connection.host,
            connection.port.unwrap_or(default_port),
            connection
                .database
                .clone()
                .unwrap_or_else(|| default_database.into()),
            postgres_dsn_query(connection)
        )
    })
}

fn postgres_dsn_query(connection: &ResolvedConnectionProfile) -> String {
    let Some(options) = &connection.postgres_options else {
        return String::new();
    };

    let mut pairs = Vec::new();
    push_trimmed_pair(
        &mut pairs,
        "application_name",
        options.application_name.as_deref(),
    );
    push_trimmed_pair(
        &mut pairs,
        "target_session_attrs",
        options.target_session_attrs.as_deref(),
    );

    if let Some(timeout) = postgres_timeout_seconds(options.connect_timeout_ms) {
        pairs.push(("connect_timeout".to_string(), timeout.to_string()));
    }
    if let Some(sslmode) = postgres_sslmode(options) {
        pairs.push(("sslmode".to_string(), sslmode));
    }
    if let Some(host) = postgres_socket_host(options) {
        pairs.push(("host".to_string(), host));
    }
    push_trimmed_pair(
        &mut pairs,
        "sslrootcert",
        options.ca_certificate_path.as_deref(),
    );
    push_trimmed_pair(
        &mut pairs,
        "sslcert",
        options.client_certificate_path.as_deref(),
    );
    push_trimmed_pair(&mut pairs, "sslkey", options.client_key_path.as_deref());

    if let Some(runtime_options) = postgres_runtime_options(options) {
        pairs.push(("options".to_string(), runtime_options));
    }

    if pairs.is_empty() {
        String::new()
    } else {
        let encoded = pairs
            .into_iter()
            .map(|(key, value)| {
                format!(
                    "{}={}",
                    postgres_uri_encode(&key),
                    postgres_uri_encode(&value)
                )
            })
            .collect::<Vec<_>>()
            .join("&");
        format!("?{encoded}")
    }
}

fn push_trimmed_pair(pairs: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        pairs.push((key.to_string(), value.to_string()));
    }
}

fn postgres_sslmode(options: &PostgresConnectionOptions) -> Option<String> {
    if options.use_tls == Some(false) {
        Some("disable".into())
    } else if options.verify_server_certificate == Some(true) {
        Some("verify-full".into())
    } else if options.use_tls == Some(true) {
        Some("require".into())
    } else {
        None
    }
}

fn postgres_socket_host(options: &PostgresConnectionOptions) -> Option<String> {
    match options.connect_mode.as_deref() {
        Some("unix-socket") => options
            .unix_socket_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        Some("cloud-sql-proxy") => options
            .cloud_sql_instance
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|instance| format!("/cloudsql/{instance}")),
        _ => None,
    }
}

fn postgres_runtime_options(options: &PostgresConnectionOptions) -> Option<String> {
    let mut commands = Vec::new();
    if let Some(search_path) = options
        .search_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        commands.push(format!("-csearch_path={search_path}"));
    }
    if let Some(statement_timeout_ms) = options.statement_timeout_ms {
        commands.push(format!("-cstatement_timeout={statement_timeout_ms}"));
    }
    if let Some(lock_timeout_ms) = options.lock_timeout_ms {
        commands.push(format!("-clock_timeout={lock_timeout_ms}"));
    }
    if let Some(idle_timeout_ms) = options.idle_in_transaction_session_timeout_ms {
        commands.push(format!(
            "-cidle_in_transaction_session_timeout={idle_timeout_ms}"
        ));
    }

    if commands.is_empty() {
        None
    } else {
        Some(commands.join(" "))
    }
}

fn postgres_timeout_seconds(value_ms: Option<u64>) -> Option<u64> {
    value_ms.map(|value| ((value.saturating_add(999)) / 1_000).max(1))
}

fn postgres_uri_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect::<Vec<_>>(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres_dsn_applies_native_profile_options() {
        let dsn = postgres_dsn(&ResolvedConnectionProfile {
            id: "conn-postgres".into(),
            name: "PostgreSQL".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            host: "db.internal".into(),
            port: Some(5432),
            database: Some("analytics".into()),
            username: Some("analyst".into()),
            password: Some("secret".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: Some(PostgresConnectionOptions {
                application_name: Some("DataPad++ QA".into()),
                search_path: Some("analytics, public".into()),
                target_session_attrs: Some("read-write".into()),
                connect_timeout_ms: Some(2_500),
                statement_timeout_ms: Some(5_000),
                lock_timeout_ms: Some(1_000),
                idle_in_transaction_session_timeout_ms: Some(30_000),
                use_tls: Some(true),
                verify_server_certificate: Some(true),
                ca_certificate_path: Some("C:/certs/root.pem".into()),
                client_certificate_path: Some("C:/certs/client.pem".into()),
                client_key_path: Some("C:/certs/client.key".into()),
                ..PostgresConnectionOptions::default()
            }),
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
        });

        assert!(dsn.starts_with("postgres://analyst:secret@db.internal:5432/analytics?"));
        assert!(dsn.contains("application_name=DataPad%2B%2B%20QA"));
        assert!(dsn.contains("target_session_attrs=read-write"));
        assert!(dsn.contains("connect_timeout=3"));
        assert!(dsn.contains("sslmode=verify-full"));
        assert!(dsn.contains("sslrootcert=C%3A%2Fcerts%2Froot.pem"));
        assert!(dsn.contains("sslcert=C%3A%2Fcerts%2Fclient.pem"));
        assert!(dsn.contains("sslkey=C%3A%2Fcerts%2Fclient.key"));
        assert!(dsn.contains(
            "options=-csearch_path%3Danalytics%2C%20public%20-cstatement_timeout%3D5000%20-clock_timeout%3D1000%20-cidle_in_transaction_session_timeout%3D30000"
        ));
    }

    #[test]
    fn postgres_dsn_uses_cloud_sql_socket_host() {
        let query = postgres_dsn_query(&ResolvedConnectionProfile {
            id: "conn-postgres".into(),
            name: "PostgreSQL".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("postgres".into()),
            username: Some("postgres".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: Some(PostgresConnectionOptions {
                connect_mode: Some("cloud-sql-proxy".into()),
                cloud_sql_instance: Some("project:region:instance".into()),
                ..PostgresConnectionOptions::default()
            }),
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
        });

        assert_eq!(query, "?host=%2Fcloudsql%2Fproject%3Aregion%3Ainstance");
    }
}
