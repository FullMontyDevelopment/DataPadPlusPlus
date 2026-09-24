use super::*;
use crate::domain::models::ConnectionAuth;

#[tokio::test]
async fn mongodb_native_options_are_accepted_and_preserved_by_the_installed_driver() {
    use mongodb::options::{ClientOptions, ReadPreference, SelectionCriteria};
    use std::time::Duration;
    let mut profile = mongo_profile(MongoDbConnectionOptions {
        connect_timeout_ms: Some(7500),
        server_selection_timeout_ms: Some(9000),
        max_idle_time_ms: Some(0),
        min_pool_size: Some(2),
        max_pool_size: Some(8),
        direct_connection: Some(true),
        retry_reads: Some(false),
        retry_writes: Some(false),
        read_preference: Some("secondaryPreferred".into()),
        ..Default::default()
    });
    profile.host = "localhost".into();
    let uri = build_mongodb_native_connection_string(&profile, None, None, None, &str::to_string)
        .unwrap();
    let parsed = ClientOptions::parse(&uri)
        .await
        .expect("installed driver accepts the emitted options");
    assert_eq!(parsed.connect_timeout, Some(Duration::from_millis(7500)));
    assert_eq!(
        parsed.server_selection_timeout,
        Some(Duration::from_millis(9000))
    );
    assert_eq!(parsed.max_idle_time, Some(Duration::ZERO));
    assert_eq!(parsed.min_pool_size, Some(2));
    assert_eq!(parsed.max_pool_size, Some(8));
    assert_eq!(parsed.direct_connection, Some(true));
    assert_eq!(parsed.retry_reads, Some(false));
    assert_eq!(parsed.retry_writes, Some(false));
    assert!(matches!(
        parsed.selection_criteria,
        Some(SelectionCriteria::ReadPreference(
            ReadPreference::SecondaryPreferred { .. }
        ))
    ));
}

#[test]
fn mongodb_certificate_paths_interpolate_and_encode_without_changing_other_options() {
    let options = MongoDbConnectionOptions {
        tls: Some(true),
        tls_ca_file: Some("{{CERT_DIR}}/café ca.pem".into()),
        tls_certificate_key_file: Some("{{CERT_DIR}}/client & key.pem".into()),
        retry_reads: Some(false),
        connect_timeout_ms: Some(0),
        ..Default::default()
    };
    let profile = mongo_profile(options.clone());
    let uri = build_mongodb_native_connection_string(&profile, None, None, None, &|value| {
        value.replace("{{CERT_DIR}}", "/certs")
    })
    .unwrap();
    assert!(uri.contains("tlsCAFile=%2Fcerts%2Fcaf%C3%A9%20ca.pem"));
    assert!(uri.contains("tlsCertificateKeyFile=%2Fcerts%2Fclient%20%26%20key.pem"));
    assert!(uri.contains("connectTimeoutMS=0"));
    assert!(uri.contains("retryReads=false"));
    assert_eq!(
        options.tls_ca_file.as_deref(),
        Some("{{CERT_DIR}}/café ca.pem")
    );
}

#[test]
fn mongodb_native_srv_options_build_atlas_uri_without_port() {
    let profile = mongo_profile(MongoDbConnectionOptions {
        connection_scheme: Some("mongodb+srv".into()),
        auth_source: Some("admin".into()),
        app_name: Some("DataPadPlusPlus".into()),
        tls: None,
        replica_set: None,
        query_timeout_ms: None,
        ..Default::default()
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
            ..Default::default()
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
