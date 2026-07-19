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
        query_timeout_ms: None,
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
            query_timeout_ms: None,
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
