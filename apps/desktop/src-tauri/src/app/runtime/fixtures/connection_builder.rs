use super::*;
use crate::domain::models::CosmosDbConnectionOptions;

pub(super) fn build_fixture_connection(
    seed: &FixtureConnectionSeed,
    _sqlite_fixture: &str,
    created_at: &str,
) -> (ConnectionProfile, Option<(SecretRef, String)>) {
    let database = if seed.use_sqlite_fixture {
        Some("${SQLITE_FIXTURE}".into())
    } else {
        seed.database.map(str::to_string)
    };
    let secret_ref = seed.password.map(|_| SecretRef {
        id: format!("secret-{}", seed.id),
        provider: "file".into(),
        service: "DataPadPlusPlusFixture".into(),
        account: seed.id.into(),
        label: format!("{} fixture credential", seed.name),
    });
    let secret = secret_ref.clone().zip(seed.password.map(str::to_string));

    (
        ConnectionProfile {
            id: seed.id.into(),
            name: seed.name.into(),
            engine: seed.engine.into(),
            family: seed.family.into(),
            host: seed.host.into(),
            port: seed.port,
            database,
            connection_string: seed
                .connection_string
                .map(|value| resolve_fixture_connection_string(value, seed)),
            connection_mode: Some(
                if seed.use_sqlite_fixture {
                    "file"
                } else {
                    "host"
                }
                .into(),
            ),
            environment_ids: vec!["env-fixtures".into()],
            tags: seed.tags.iter().map(|tag| (*tag).to_string()).collect(),
            favorite: seed.profile.is_none(),
            redis_options: None,
            memcached_options: None,
            mongodb_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: mysql_options_for_seed(seed),
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: cosmosdb_options_for_seed(seed),
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
            icon: seed.icon.into(),
            color: Some(seed.color.into()),
            group: Some(seed.group.into()),
            notes: Some("Seeded only for fixture debug workspaces.".into()),
            auth: ConnectionAuth {
                username: seed.username.map(str::to_string),
                auth_mechanism: seed.auth_mechanism.map(str::to_string),
                ssl_mode: seed.ssl_mode.map(str::to_string),
                cloud_provider: None,
                principal: None,
                secret_ref,
            },
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        secret,
    )
}

fn cosmosdb_options_for_seed(seed: &FixtureConnectionSeed) -> Option<CosmosDbConnectionOptions> {
    if seed.id != "fixture-cosmosdb" {
        return None;
    }

    Some(CosmosDbConnectionOptions {
        api: Some("nosql".into()),
        database_name: seed.database.map(str::to_string),
        container_prefix: Some("orders".into()),
        ..CosmosDbConnectionOptions::default()
    })
}

pub(super) fn mysql_options_for_seed(
    seed: &FixtureConnectionSeed,
) -> Option<MySqlConnectionOptions> {
    if !matches!(seed.engine, "mysql" | "mariadb") {
        return None;
    }
    let is_mariadb = seed.engine == "mariadb";

    Some(MySqlConnectionOptions {
        connect_mode: Some("tcp".into()),
        auth_mode: Some("password".into()),
        ssl_mode: seed.ssl_mode.map(|mode| match mode {
            "disable" => "disabled".into(),
            "require" => "required".into(),
            "verify-ca" => "verify-ca".into(),
            "verify-full" => "verify-identity".into(),
            _ => "preferred".into(),
        }),
        server_flavor: Some(if is_mariadb { "mariadb" } else { "mysql" }.into()),
        charset: Some("utf8mb4".into()),
        collation: Some(
            if is_mariadb {
                "utf8mb4_unicode_ci"
            } else {
                "utf8mb4_0900_ai_ci"
            }
            .into(),
        ),
        time_zone: Some("+00:00".into()),
        sql_mode: Some("STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION".into()),
        default_storage_engine: Some(if is_mariadb { "Aria" } else { "InnoDB" }.into()),
        allow_local_infile: Some(false),
        statement_cache_capacity: Some(100),
        connect_timeout_ms: Some(5_000),
        command_timeout_ms: Some(30_000),
        ..MySqlConnectionOptions::default()
    })
}
