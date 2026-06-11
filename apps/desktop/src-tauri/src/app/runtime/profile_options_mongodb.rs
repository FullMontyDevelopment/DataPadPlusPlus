use crate::domain::models::{ConnectionProfile, MongoDbConnectionOptions};

pub(super) fn build_mongodb_native_connection_string(
    profile: &ConnectionProfile,
    database: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
    interpolate: &impl Fn(&str) -> String,
) -> Option<String> {
    if profile.engine != "mongodb" || profile.connection_string.as_deref().is_some() {
        return None;
    }

    let options = profile
        .mongodb_options
        .as_ref()
        .map(|options| interpolate_mongodb_options(options, interpolate))?;
    let scheme = mongodb_connection_scheme(&options);
    let host = interpolate(&profile.host).trim().to_string();
    if host.is_empty() {
        return None;
    }

    let credentials = username
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(
            |username| match password.filter(|value| !value.is_empty()) {
                Some(password) => format!(
                    "{}:{}@",
                    percent_encode_uri_component(username),
                    percent_encode_uri_component(password)
                ),
                None => format!("{}@", percent_encode_uri_component(username)),
            },
        )
        .unwrap_or_default();
    let authority = if scheme == "mongodb" && !host.contains(',') && !host.contains(':') {
        format!("{}:{}", host, profile.port.unwrap_or(27017))
    } else {
        host
    };
    let database = database.map(str::trim).filter(|value| !value.is_empty());
    let path = database
        .map(|value| format!("/{}", percent_encode_uri_component(value)))
        .unwrap_or_else(|| "/".into());
    let query = mongodb_connection_query(&options, database, username);

    Some(if query.is_empty() {
        format!("{scheme}://{credentials}{authority}{path}")
    } else {
        format!("{scheme}://{credentials}{authority}{path}?{query}")
    })
}

fn interpolate_mongodb_options(
    options: &MongoDbConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> MongoDbConnectionOptions {
    MongoDbConnectionOptions {
        connection_scheme: options.connection_scheme.clone(),
        auth_source: options.auth_source.as_deref().map(interpolate),
        app_name: options.app_name.as_deref().map(interpolate),
        tls: options.tls,
        replica_set: options.replica_set.as_deref().map(interpolate),
    }
}

fn mongodb_connection_scheme(options: &MongoDbConnectionOptions) -> &'static str {
    match options.connection_scheme.as_deref() {
        Some("mongodb+srv") => "mongodb+srv",
        _ => "mongodb",
    }
}

fn mongodb_connection_query(
    options: &MongoDbConnectionOptions,
    database: Option<&str>,
    username: Option<&str>,
) -> String {
    let mut params = Vec::new();
    let auth_source = options
        .auth_source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let has_username = username
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            let database = database.unwrap_or_default();
            (has_username && database != "admin").then_some("admin")
        });
    if let Some(auth_source) = auth_source {
        params.push(("authSource", auth_source.to_string()));
    }
    if let Some(app_name) = options
        .app_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("appName", app_name.to_string()));
    }
    if let Some(tls) = options.tls {
        params.push(("tls", tls.to_string()));
    }
    if let Some(replica_set) = options
        .replica_set
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("replicaSet", replica_set.to_string()));
    }

    params
        .into_iter()
        .map(|(key, value)| format!("{key}={}", percent_encode_uri_component(&value)))
        .collect::<Vec<_>>()
        .join("&")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::ConnectionAuth;

    #[test]
    fn mongodb_native_srv_options_build_atlas_uri_without_port() {
        let profile = mongo_profile(MongoDbConnectionOptions {
            connection_scheme: Some("mongodb+srv".into()),
            auth_source: Some("admin".into()),
            app_name: Some("DataPadPlusPlus".into()),
            tls: None,
            replica_set: None,
        });

        let uri = build_mongodb_native_connection_string(
            &profile,
            None,
            Some("gareth@example.com"),
            Some("p@ss word"),
            &|value| value.to_string(),
        )
        .expect("uri");

        assert_eq!(
            uri,
            "mongodb+srv://gareth%40example.com:p%40ss%20word@datapadplusplus.kkravqn.mongodb.net/?authSource=admin&appName=DataPadPlusPlus"
        );
        assert!(!uri.contains(":27017"));
    }

    #[test]
    fn mongodb_native_standard_options_build_multi_host_uri_with_replica_set() {
        let profile = ConnectionProfile {
            host: "shard-00-00.example.net:27017,shard-00-01.example.net:27017".into(),
            port: Some(27017),
            database: Some("catalog".into()),
            mongodb_options: Some(MongoDbConnectionOptions {
                connection_scheme: Some("mongodb".into()),
                auth_source: Some("admin".into()),
                app_name: Some("DataPadPlusPlus".into()),
                tls: Some(true),
                replica_set: Some("atlas-rs".into()),
            }),
            ..mongo_profile(MongoDbConnectionOptions::default())
        };

        let uri = build_mongodb_native_connection_string(
            &profile,
            Some("catalog"),
            Some("user"),
            Some("secret"),
            &|value| value.to_string(),
        )
        .expect("uri");

        assert_eq!(
            uri,
            "mongodb://user:secret@shard-00-00.example.net:27017,shard-00-01.example.net:27017/catalog?authSource=admin&appName=DataPadPlusPlus&tls=true&replicaSet=atlas-rs"
        );
    }

    #[test]
    fn explicit_connection_string_overrides_mongodb_native_options() {
        let mut profile = mongo_profile(MongoDbConnectionOptions {
            connection_scheme: Some("mongodb+srv".into()),
            ..MongoDbConnectionOptions::default()
        });
        profile.connection_string = Some("mongodb://raw.example.test/catalog".into());

        assert!(build_mongodb_native_connection_string(
            &profile,
            Some("catalog"),
            Some("user"),
            Some("secret"),
            &|value| value.to_string(),
        )
        .is_none());
    }

    fn mongo_profile(options: MongoDbConnectionOptions) -> ConnectionProfile {
        ConnectionProfile {
            id: "conn-mongo".into(),
            name: "MongoDB Atlas".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            host: "datapadplusplus.kkravqn.mongodb.net".into(),
            port: Some(27017),
            connection_mode: Some("native".into()),
            auth: ConnectionAuth {
                username: Some("gareth@example.com".into()),
                ..ConnectionAuth::default()
            },
            mongodb_options: Some(options),
            environment_ids: Vec::new(),
            tags: Vec::new(),
            favorite: false,
            read_only: false,
            icon: "mongodb".into(),
            created_at: "2026-06-11T00:00:00.000Z".into(),
            updated_at: "2026-06-11T00:00:00.000Z".into(),
            ..ConnectionProfile::default()
        }
    }
}
