use super::{
    collection_info_payload, gridfs_buckets_from_infos, gridfs_chunk_payload, gridfs_file_payload,
    infer_schema_fields, is_gridfs_collection, mongodb_collection_children,
    mongodb_collection_node, mongodb_database_children, mongodb_principal_payload,
    mongodb_root_database_nodes, split_database_collection_item, split_database_item,
    MongoCollectionInfo,
};
use crate::domain::models::ResolvedConnectionProfile;
use mongodb::bson::{doc, spec::BinarySubtype, Binary};

#[test]
fn mongodb_root_nodes_separate_user_and_system_databases() {
    let connection = resolved_connection(None);
    let nodes = mongodb_root_database_nodes(
        &connection,
        vec!["admin".into(), "catalog".into(), "local".into()],
        100,
    );

    assert_eq!(nodes[0].label, "catalog");
    assert_eq!(nodes[0].scope.as_deref(), Some("database:catalog"));
    assert_eq!(nodes[1].label, "admin");
    assert_eq!(
        nodes[1].path.as_ref().unwrap(),
        &vec!["System Databases".to_string()]
    );
}

#[test]
fn mongodb_database_children_use_native_mongo_sections() {
    let connection = resolved_connection(Some("catalog"));
    let nodes = mongodb_database_children(&connection, "catalog");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Collections",
            "Views",
            "Time Series Collections",
            "Capped Collections",
            "GridFS",
            "Search Indexes",
            "Vector Indexes",
            "Users",
            "Roles",
            "Database Statistics",
        ]
    );
    assert_eq!(nodes[0].scope.as_deref(), Some("collections:catalog"));
}

#[test]
fn mongodb_collection_children_expose_documents_schema_indexes_validation_and_aggregations() {
    let connection = resolved_connection(Some("catalog"));
    let nodes = mongodb_collection_children(&connection, "catalog", "products");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Documents",
            "Schema Preview",
            "Indexes",
            "Validation Rules",
            "Aggregations",
            "Statistics",
            "Permissions",
            "Scripts",
        ]
    );
    assert_eq!(
        nodes[0].scope.as_deref(),
        Some("collection:catalog:products")
    );
    assert!(nodes[0]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("\"database\": \"catalog\""));
    let validation_template = nodes
        .iter()
        .find(|node| node.kind == "validation-rules")
        .and_then(|node| node.query_template.as_deref())
        .unwrap_or_default();
    assert!(validation_template.contains("listCollections"));
    assert!(!validation_template.contains("collMod"));
}

#[test]
fn mongodb_collection_nodes_have_database_scoped_queries() {
    let connection = resolved_connection(Some("catalog"));
    let node = mongodb_collection_node(&connection, "products");
    assert_eq!(node.scope.as_deref(), Some("collection:catalog:products"));
    assert_eq!(node.expandable, Some(true));
    assert!(node
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("\"collection\": \"products\""));
}

#[test]
fn mongodb_schema_preview_infers_nested_bson_fields() {
    let fields = infer_schema_fields(&[
        doc! {
            "_id": "p1",
            "sku": "luna-lamp",
            "inventory": { "available": 3_i32 },
        },
        doc! {
            "_id": "p2",
            "sku": "aurora-desk",
            "inventory": { "available": 8_i64 },
        },
    ]);
    let paths = fields
        .iter()
        .map(|field| field["path"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();

    assert!(paths.contains(&"_id"));
    assert!(paths.contains(&"inventory"));
    assert!(paths.contains(&"inventory.available"));
    let inventory = fields
        .iter()
        .find(|field| field["path"] == "inventory.available")
        .unwrap();
    assert_eq!(inventory["presenceCount"], 2);
    assert_eq!(inventory["typeDistribution"]["int32"], 1);
    assert_eq!(inventory["typeDistribution"]["int64"], 1);
    let sku = fields.iter().find(|field| field["path"] == "sku").unwrap();
    assert_eq!(sku["examples"].as_array().unwrap().len(), 2);
}

#[test]
fn mongodb_database_overview_helpers_classify_collections() {
    let infos = vec![
        MongoCollectionInfo {
            name: "products".into(),
            collection_type: mongodb::results::CollectionType::Collection,
            options: doc! {},
        },
        MongoCollectionInfo {
            name: "fs.files".into(),
            collection_type: mongodb::results::CollectionType::Collection,
            options: doc! {},
        },
        MongoCollectionInfo {
            name: "active_products".into(),
            collection_type: mongodb::results::CollectionType::View,
            options: doc! { "pipeline": [{ "$match": { "active": true } }] },
        },
    ];

    assert!(!is_gridfs_collection(&infos[0].name));
    assert!(is_gridfs_collection(&infos[1].name));
    assert_eq!(gridfs_buckets_from_infos(&infos)[0]["name"], "fs");
    let view = collection_info_payload(&infos[2]);
    assert_eq!(view["name"], "active_products");
    assert_eq!(view["pipeline"].as_array().unwrap().len(), 1);
}

#[test]
fn mongodb_gridfs_payloads_are_bounded_metadata_without_binary_bodies() {
    let file = gridfs_file_payload(&doc! {
        "_id": "file-1",
        "filename": "report.pdf",
        "length": 2048_i64,
        "metadata": { "tenant": "qa" },
    });
    let chunk = gridfs_chunk_payload(&doc! {
        "_id": "chunk-1",
        "files_id": "file-1",
        "n": 0_i32,
        "data": Binary {
            subtype: BinarySubtype::Generic,
            bytes: vec![1, 2, 3, 4],
        },
    });

    assert_eq!(file["filename"], "report.pdf");
    assert_eq!(chunk["size"], 4);
    assert_eq!(chunk["files_id"], "file-1");
    assert!(chunk.get("data").is_none());
    assert!(!chunk.to_string().contains("AQIDBA"));
}

#[test]
fn mongodb_leaf_inspection_scopes_preserve_database_collection_and_item_names() {
    assert_eq!(
        split_database_collection_item("catalog:products:sku_1", "admin"),
        ("catalog".into(), "products".into(), "sku_1".into())
    );
    assert_eq!(
        split_database_item("catalog:fixture_reader", "admin"),
        ("catalog".into(), "fixture_reader".into())
    );
}

#[test]
fn mongodb_principal_payload_excludes_credentials_and_password_material() {
    let payload = mongodb_principal_payload(
        &doc! {
            "user": "fixture_reader",
            "db": "catalog",
            "roles": [{ "role": "read", "db": "catalog" }],
            "inheritedPrivileges": [{
                "resource": { "db": "catalog", "collection": "products" },
                "actions": ["find"],
            }],
            "credentials": { "SCRAM-SHA-256": { "storedKey": "secret" } },
            "password": "secret",
        },
        "user",
    );

    assert_eq!(payload["user"], "fixture_reader");
    assert_eq!(payload["roles"][0]["role"], "read");
    assert_eq!(payload["inheritedPrivileges"][0]["actions"][0], "find");
    assert!(payload.get("credentials").is_none());
    assert!(payload.get("password").is_none());
    assert!(!payload.to_string().contains("secret"));
}

fn resolved_connection(database: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-mongo".into(),
        name: "Mongo".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: database.map(str::to_string),
        username: None,
        password: None,
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
