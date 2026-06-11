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
#[path = "../../../../tests/unit/adapters/datastores/postgresql/connection_tests.rs"]
mod tests;
