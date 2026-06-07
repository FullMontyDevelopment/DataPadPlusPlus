use super::super::super::*;

pub(super) async fn redis_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<redis::aio::MultiplexedConnection, CommandError> {
    let uri = redis_connection_uri(connection).await?;
    let client = redis::Client::open(uri)?;
    let mut redis = client.get_multiplexed_async_connection().await?;
    apply_connection_session_options(connection, &mut redis).await?;
    Ok(redis)
}

pub(super) async fn test_redis_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let mut redis = redis_connection(connection).await?;
    let _: String = redis::cmd("PING").query_async(&mut redis).await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings: redis_connection_warnings(connection),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn select_redis_database(
    redis: &mut redis::aio::MultiplexedConnection,
    database_index: Option<u32>,
) -> Result<(), CommandError> {
    if let Some(database_index) = database_index {
        let _: String = redis::cmd("SELECT")
            .arg(database_index)
            .query_async(redis)
            .await?;
    }
    Ok(())
}

pub(super) fn configured_database_index(connection: &ResolvedConnectionProfile) -> Option<u32> {
    connection
        .redis_options
        .as_ref()
        .and_then(|options| options.database_index)
        .or_else(|| {
            connection
                .database
                .as_deref()
                .and_then(|value| value.trim().parse::<u32>().ok())
        })
}

pub(super) async fn redis_connection_uri(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    if let Some(connection_string) = connection
        .connection_string
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if cfg!(windows)
            && connection_string
                .to_ascii_lowercase()
                .starts_with("redis+unix")
        {
            return Err(CommandError::new(
                "redis-unix-socket-unavailable",
                "Redis Unix socket connections are not available on Windows. Use TCP host and port settings instead.",
            ));
        }
        return Ok(connection_string.into());
    }

    let options = connection.redis_options.as_ref();
    let deployment = options
        .and_then(|options| options.deployment_mode.as_deref())
        .unwrap_or("standalone");

    if deployment == "sentinel" {
        return redis_sentinel_master_uri(connection).await;
    }

    if cfg!(windows) && deployment == "unix-socket" {
        return Err(CommandError::new(
            "redis-unix-socket-unavailable",
            "Redis Unix socket connections are not available on Windows. Use TCP host and port settings instead.",
        ));
    }

    let endpoint = if deployment == "cluster" {
        options
            .and_then(|options| options.cluster_nodes.first())
            .cloned()
            .unwrap_or_else(|| host_port(&connection.host, connection.port.unwrap_or(6379)))
    } else {
        host_port(&connection.host, connection.port.unwrap_or(6379))
    };

    Ok(redis_uri_from_endpoint(connection, &endpoint, deployment))
}

async fn redis_sentinel_master_uri(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let Some(options) = connection.redis_options.as_ref() else {
        return Ok(redis_uri_from_endpoint(
            connection,
            &host_port(&connection.host, connection.port.unwrap_or(6379)),
            "standalone",
        ));
    };
    let Some(master_name) = options
        .sentinel_master_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(CommandError::new(
            "redis-sentinel-master-missing",
            "Redis Sentinel connections need a master name.",
        ));
    };
    let Some(sentinel_host) = options.sentinel_hosts.first() else {
        return Err(CommandError::new(
            "redis-sentinel-hosts-missing",
            "Redis Sentinel connections need at least one Sentinel host.",
        ));
    };

    let sentinel_uri = redis_uri_from_parts(
        if options.use_sentinel_tls.unwrap_or(false) {
            "rediss"
        } else {
            "redis"
        },
        sentinel_host,
        None,
        options.sentinel_username.as_deref(),
        None,
        options.allow_invalid_certificates.unwrap_or(false)
            || options.allow_invalid_hostnames.unwrap_or(false),
        options.resp_version.as_deref(),
    );
    let sentinel_client = redis::Client::open(sentinel_uri)?;
    let mut sentinel = sentinel_client.get_multiplexed_async_connection().await?;
    let master: Vec<String> = redis::cmd("SENTINEL")
        .arg("get-master-addr-by-name")
        .arg(master_name)
        .query_async(&mut sentinel)
        .await?;
    let Some(host) = master.first() else {
        return Err(CommandError::new(
            "redis-sentinel-master-not-found",
            format!("Redis Sentinel did not return a master for `{master_name}`."),
        ));
    };
    let port = master
        .get(1)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(6379);
    Ok(redis_uri_from_endpoint(
        connection,
        &host_port(host, port),
        if options.use_tls.unwrap_or(false) {
            "tls"
        } else {
            "standalone"
        },
    ))
}

fn redis_uri_from_endpoint(
    connection: &ResolvedConnectionProfile,
    endpoint: &str,
    deployment: &str,
) -> String {
    let options = connection.redis_options.as_ref();
    let scheme = if deployment == "unix-socket" {
        "redis+unix"
    } else if deployment == "tls" || options.is_some_and(|options| options.use_tls.unwrap_or(false))
    {
        "rediss"
    } else {
        "redis"
    };
    let db = configured_database_index(connection);
    let username = connection.username.as_deref();
    let password = connection.password.as_deref();
    let insecure = options.is_some_and(|options| {
        options.allow_invalid_certificates.unwrap_or(false)
            || options.allow_invalid_hostnames.unwrap_or(false)
    });
    let resp_version = options.and_then(|options| options.resp_version.as_deref());
    let unix_socket_path = options
        .and_then(|options| options.unix_socket_path.as_deref())
        .unwrap_or(&connection.host);
    let endpoint = if deployment == "unix-socket" {
        unix_socket_path
    } else {
        endpoint
    };

    redis_uri_from_parts(
        scheme,
        endpoint,
        db,
        username,
        password,
        insecure,
        resp_version,
    )
}

fn redis_uri_from_parts(
    scheme: &str,
    endpoint: &str,
    database_index: Option<u32>,
    username: Option<&str>,
    password: Option<&str>,
    insecure: bool,
    resp_version: Option<&str>,
) -> String {
    if scheme.ends_with("+unix") {
        let mut params = Vec::new();
        if let Some(database_index) = database_index {
            params.push(format!("db={database_index}"));
        }
        if let Some(username) = username.filter(|value| !value.is_empty()) {
            params.push(format!("user={}", percent_encode(username)));
        }
        if let Some(password) = password.filter(|value| !value.is_empty()) {
            params.push(format!("pass={}", percent_encode(password)));
        }
        if let Some(protocol) = normalized_resp_protocol(resp_version) {
            params.push(format!("protocol={protocol}"));
        }
        return format!(
            "{scheme}://{}{}",
            endpoint,
            if params.is_empty() {
                String::new()
            } else {
                format!("?{}", params.join("&"))
            }
        );
    }

    let auth = match (
        username.filter(|value| !value.is_empty()),
        password.filter(|value| !value.is_empty()),
    ) {
        (Some(username), Some(password)) => {
            format!("{}:{}@", percent_encode(username), percent_encode(password))
        }
        (None, Some(password)) => format!(":{}@", percent_encode(password)),
        (Some(username), None) => format!("{}@", percent_encode(username)),
        _ => String::new(),
    };
    let db = database_index
        .map(|database_index| format!("/{database_index}"))
        .unwrap_or_else(|| "/0".into());
    let query = normalized_resp_protocol(resp_version)
        .map(|protocol| format!("?protocol={protocol}"))
        .unwrap_or_default();
    let fragment = if insecure { "#insecure" } else { "" };
    format!("{scheme}://{auth}{endpoint}{db}{query}{fragment}")
}

async fn apply_connection_session_options(
    connection: &ResolvedConnectionProfile,
    redis: &mut redis::aio::MultiplexedConnection,
) -> Result<(), CommandError> {
    let Some(options) = connection.redis_options.as_ref() else {
        return Ok(());
    };

    if let Some(client_name) = options
        .client_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let _: String = redis::cmd("CLIENT")
            .arg("SETNAME")
            .arg(client_name)
            .query_async(redis)
            .await?;
    }

    if options.read_only_mode.unwrap_or(false) {
        let _: String = redis::cmd("READONLY").query_async(redis).await?;
    }

    Ok(())
}

fn redis_connection_warnings(connection: &ResolvedConnectionProfile) -> Vec<String> {
    let Some(options) = connection.redis_options.as_ref() else {
        return Vec::new();
    };
    let mut warnings = Vec::new();
    if matches!(options.deployment_mode.as_deref(), Some("cluster")) {
        warnings.push(
            "Redis Cluster connects to the configured seed node in this build; MOVED/ASK redirects are surfaced with guidance.".into(),
        );
    }
    if options.ca_certificate_path.is_some()
        || options.client_certificate_path.is_some()
        || options.client_key_path.is_some()
    {
        warnings.push(
            "Redis certificate file paths are stored as connection metadata. Native TLS uses the platform trust store in this build.".into(),
        );
    }
    warnings
}

fn host_port(host: &str, port: u16) -> String {
    if host.contains(':') && host.ends_with(']') {
        format!("{host}:{port}")
    } else if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn normalized_resp_protocol(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::to_ascii_lowercase).as_deref() {
        Some("3" | "resp3") => Some("3"),
        Some("2" | "resp2") => Some("2"),
        _ => None,
    }
}

fn percent_encode(value: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::{redis_uri_from_endpoint, redis_uri_from_parts};
    use crate::domain::models::{RedisConnectionOptions, ResolvedConnectionProfile};

    #[test]
    fn builds_standalone_acl_uri_with_database_and_resp_version() {
        let connection = connection(Some(RedisConnectionOptions {
            database_index: Some(2),
            resp_version: Some("resp3".into()),
            ..RedisConnectionOptions::default()
        }));

        assert_eq!(
            redis_uri_from_endpoint(&connection, "localhost:6379", "standalone"),
            "redis://user:p%40ss@localhost:6379/2?protocol=3"
        );
    }

    #[test]
    fn builds_tls_and_unix_redis_uris() {
        let tls = connection(Some(RedisConnectionOptions {
            use_tls: Some(true),
            allow_invalid_certificates: Some(true),
            ..RedisConnectionOptions::default()
        }));
        assert_eq!(
            redis_uri_from_endpoint(&tls, "cache.example.com:6380", "tls"),
            "rediss://user:p%40ss@cache.example.com:6380/0#insecure"
        );

        assert_eq!(
            redis_uri_from_parts(
                "redis+unix",
                "/var/run/redis.sock",
                Some(1),
                Some("user"),
                Some("p@ss"),
                false,
                Some("resp2"),
            ),
            "redis+unix:///var/run/redis.sock?db=1&user=user&pass=p%40ss&protocol=2"
        );
    }

    fn connection(redis_options: Option<RedisConnectionOptions>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "redis".into(),
            name: "Redis".into(),
            engine: "redis".into(),
            family: "keyvalue".into(),
            host: "localhost".into(),
            port: Some(6379),
            database: Some("0".into()),
            username: Some("user".into()),
            password: Some("p@ss".into()),
            connection_string: None,
            redis_options,
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
