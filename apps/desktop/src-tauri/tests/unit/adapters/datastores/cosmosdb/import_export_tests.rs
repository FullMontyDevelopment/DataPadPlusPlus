use std::{collections::BTreeMap, fs};

use serde_json::json;

use super::super::connection::{cosmosdb_create_resource, cosmosdb_delete_resource};
use super::*;
use crate::domain::models::CosmosDbConnectionOptions;

#[test]
fn export_envelope_preserves_data_and_separates_server_evidence() {
    let envelope = export_envelope(
        "catalog",
        "orders",
        &["/tenant/id".into(), "/region".into()],
        &json!({
            "id": "order-1",
            "tenant": {"id": "tenant-a"},
            "region": "af-south-1",
            "amount": 9007199254740993_u64,
            "_rid": "server-rid",
            "_self": "server-self",
            "_etag": "server-etag",
            "_attachments": "attachments/",
            "_ts": 42
        }),
        1,
    )
    .unwrap();

    assert_eq!(envelope["partitionKey"], json!(["tenant-a", "af-south-1"]));
    assert_eq!(envelope["document"]["amount"], json!(9007199254740993_u64));
    assert_eq!(envelope["sourceEtag"], json!("server-etag"));
    assert_eq!(envelope["sourceTimestamp"], json!(42));
    for field in ["_rid", "_self", "_etag", "_attachments", "_ts"] {
        assert!(envelope["document"].get(field).is_none());
    }
}

#[test]
fn import_envelope_rejects_partition_schema_and_value_mismatches() {
    let valid = json!({
        "formatVersion": 1,
        "source": {
            "database": "catalog",
            "container": "orders",
            "partitionKeyPaths": ["/tenant/id", "/region"]
        },
        "partitionKey": ["tenant-a", "af-south-1"],
        "document": {
            "id": "order-1",
            "tenant": {"id": "tenant-a"},
            "region": "af-south-1"
        }
    });
    parse_envelope(
        &valid.to_string(),
        1,
        &["/tenant/id".into(), "/region".into()],
    )
    .unwrap();

    let mut wrong_value = valid.clone();
    wrong_value["partitionKey"][0] = json!("tenant-b");
    assert_eq!(
        parse_envelope(
            &wrong_value.to_string(),
            1,
            &["/tenant/id".into(), "/region".into()],
        )
        .unwrap_err()
        .code,
        "cosmosdb-transfer-partition-value-mismatch"
    );

    assert_eq!(
        parse_envelope(&valid.to_string(), 1, &["/accountId".into()])
            .unwrap_err()
            .code,
        "cosmosdb-transfer-partition-schema-mismatch"
    );
}

#[test]
fn import_envelope_rejects_system_fields_and_invalid_identity() {
    let envelope = |document: Value| {
        json!({
            "formatVersion": 1,
            "source": {"partitionKeyPaths": ["/pk"]},
            "partitionKey": ["tenant-a"],
            "document": document
        })
        .to_string()
    };

    assert_eq!(
        parse_envelope(
            &envelope(json!({"id": "one", "pk": "tenant-a", "_etag": "unsafe"})),
            1,
            &["/pk".into()],
        )
        .unwrap_err()
        .code,
        "cosmosdb-transfer-system-field-invalid"
    );
    assert_eq!(
        parse_envelope(
            &envelope(json!({"id": 7, "pk": "tenant-a"})),
            1,
            &["/pk".into()],
        )
        .unwrap_err()
        .code,
        "cosmosdb-transfer-id-invalid"
    );
}

#[test]
fn transfer_target_understands_explorer_scope_and_plan_is_guarded() {
    let connection = test_connection();
    let mut request = request(json!({"mode": "export"}));
    request.object_name = Some("container:catalog:orders".into());
    assert_eq!(
        transfer_target(&connection, &request).unwrap(),
        ("catalog".into(), "orders".into())
    );

    let parameters = BTreeMap::from([
        ("mode".into(), json!("import")),
        ("database".into(), json!("catalog")),
        ("container".into(), json!("orders_copy")),
    ]);
    let plan = cosmosdb_transfer_plan(
        &connection,
        "cosmosdb.data.import-export",
        None,
        Some(&parameters),
    );
    assert!(plan.generated_request.contains("partitionkey"));
    assert!(plan.summary.contains("catalog.orders_copy"));
    assert!(plan
        .estimated_scan_impact
        .unwrap()
        .contains("does not roll back"));
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn live_cosmosdb_json_lines_round_trip_and_conflict_protection() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = test_connection();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let target = format!("transfer_target_{suffix}");
    let path = std::env::temp_dir().join(format!("datapad-cosmosdb-{suffix}.jsonl"));

    cosmosdb_create_resource(
        &connection,
        "/dbs/datapadplusplus/colls",
        &json!({
            "id": target,
            "partitionKey": {"paths": ["/sku"], "kind": "Hash"}
        })
        .to_string(),
    )
    .await
    .unwrap();

    let result = async {
        let exported = export_container(
            &connection,
            "datapadplusplus",
            "products",
            &["/sku".into()],
            &path,
            false,
        )
        .await?;
        assert_eq!(exported.documents, 3);

        let imported = import_container(
            &connection,
            "datapadplusplus",
            &target,
            &["/sku".into()],
            &path,
        )
        .await?;
        assert_eq!(imported.documents, 3);

        let query = cosmosdb_query_body("SELECT * FROM c ORDER BY c.id", None);
        let response = cosmosdb_post_query(
            &connection,
            &format!("/dbs/datapadplusplus/colls/{target}/docs"),
            &query,
            CosmosDbQueryRequestOptions {
                max_item_count: 100,
                enable_cross_partition: true,
                ..CosmosDbQueryRequestOptions::default()
            },
            None,
        )
        .await?;
        let actual: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(actual["_count"], json!(3));
        let documents = actual["Documents"].as_array().unwrap();
        assert!(documents
            .iter()
            .any(|value| { value["id"] == json!("luna-lamp") && value["price"] == json!(49.99) }));

        let conflict = import_container(
            &connection,
            "datapadplusplus",
            &target,
            &["/sku".into()],
            &path,
        )
        .await
        .unwrap_err();
        assert_eq!(conflict.code, "cosmosdb-transfer-import-failed");
        assert!(conflict.message.contains("after 0 confirmed create"));
        Ok::<(), CommandError>(())
    }
    .await;

    let _ = cosmosdb_delete_resource(&connection, &format!("/dbs/datapadplusplus/colls/{target}"))
        .await;
    let _ = fs::remove_file(path);
    result.unwrap();
}

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-cosmosdb".into(),
        environment_id: "environment-local".into(),
        operation_id: "cosmosdb.data.import-export".into(),
        object_name: None,
        parameters: parameters
            .as_object()
            .map(|values| values.clone().into_iter().collect()),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-cosmosdb".into(),
        name: "Cosmos DB fixture".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: Some(8082),
        database: Some("datapadplusplus".into()),
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
        cosmos_db_options: Some(CosmosDbConnectionOptions {
            connect_mode: Some("emulator".into()),
            api: Some("nosql".into()),
            account_endpoint: Some("http://127.0.0.1:8082".into()),
            database_name: Some("datapadplusplus".into()),
            auth_mode: Some("emulator".into()),
            allow_self_signed_emulator_certificate: Some(true),
            max_retry_attempts: Some(0),
            ..CosmosDbConnectionOptions::default()
        }),
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
