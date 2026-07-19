use std::collections::HashMap;

use crate::domain::{
    error::CommandError,
    models::{
        DataEditChange, DataEditExecutionRequest, DataEditPlanRequest, DataEditTarget,
        DatastoreEditableScope, DatastoreExperienceManifest, ResolvedConnectionProfile,
    },
};
use serde_json::json;

use super::*;

#[test]
fn sql_update_without_primary_key_warns_and_keeps_preview_predicate() {
    let connection = connection("postgresql", "sql", false);
    let experience = experience(&["update-row"], true);
    let request = request(
        "update-row",
        DataEditTarget {
            object_kind: "row".into(),
            schema: Some("public".into()),
            table: Some("accounts".into()),
            ..Default::default()
        },
        vec![change("name", json!("DataPad++ Labs"))],
    );

    let plan = default_data_edit_plan(&connection, &experience, &request);

    assert_eq!(plan.execution_support, "live");
    assert!(plan.plan.generated_request.contains(
        "update \"public\".\"accounts\" set \"name\" = $1 where <primary-key> = <value>;"
    ));
    assert!(plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("complete primary key")));
}

#[test]
fn sql_dialects_quote_identifiers_and_parameters_for_preview_requests() {
    let request = request(
        "update-row",
        DataEditTarget {
            object_kind: "row".into(),
            schema: Some("dbo".into()),
            table: Some("accounts".into()),
            primary_key: Some(HashMap::from([("account_id".into(), json!(42))])),
            ..Default::default()
        },
        vec![change("display_name", json!("DataPad++ Labs"))],
    );

    let sqlserver = default_data_edit_plan(
        &connection("sqlserver", "sql", false),
        &experience(&["update-row"], true),
        &request,
    );
    let mysql = default_data_edit_plan(
        &connection("mysql", "sql", false),
        &experience(&["update-row"], true),
        &DataEditPlanRequest {
            target: DataEditTarget {
                schema: Some("commerce".into()),
                ..request.target.clone()
            },
            ..request.clone()
        },
    );
    let postgres = default_data_edit_plan(
        &connection("postgresql", "sql", false),
        &experience(&["update-row"], true),
        &DataEditPlanRequest {
            target: DataEditTarget {
                schema: Some("public".into()),
                ..request.target.clone()
            },
            ..request.clone()
        },
    );

    assert!(sqlserver
        .plan
        .generated_request
        .contains("update [dbo].[accounts] set [display_name] = @p1 where [account_id] = @p2;"));
    assert!(mysql
        .plan
        .generated_request
        .contains("update `commerce`.`accounts` set `display_name` = ? where `account_id` = ?;"));
    assert!(postgres.plan.generated_request.contains(
        "update \"public\".\"accounts\" set \"display_name\" = $1 where \"account_id\" = $2;"
    ));
}

#[test]
fn timescale_row_edit_preview_pins_returning_evidence_contract() {
    let plan = default_data_edit_plan(
        &connection("timescaledb", "timeseries", false),
        &experience(&["update-row"], true),
        &request(
            "update-row",
            DataEditTarget {
                object_kind: "row".into(),
                schema: Some("metrics".into()),
                table: Some("conditions".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(1))])),
                ..Default::default()
            },
            vec![change("temperature", json!(72.5))],
        ),
    );

    assert_eq!(plan.execution_support, "live");
    assert_eq!(plan.plan.request_language, "sql");
    assert!(plan
        .plan
        .required_permissions
        .contains(&"update-row on table".into()));
    assert!(plan
        .plan
        .generated_request
        .contains("select * from \"metrics\".\"conditions\" where \"id\" = $1 limit 2;"));
    assert!(plan.plan.generated_request.contains(
        "update \"metrics\".\"conditions\" set \"temperature\" = $1 where \"id\" = $2 returning *;"
    ));
    assert!(plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("RETURNING * before/after evidence")));
    assert!(!plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("no live data-edit surface")));
}

#[test]
fn oracle_row_edit_preview_pins_sqlplus_identity_evidence_contract() {
    let update_plan = default_data_edit_plan(
        &connection("oracle", "sql", false),
        &experience(&["update-row"], true),
        &request(
            "update-row",
            DataEditTarget {
                object_kind: "row".into(),
                schema: Some("APP".into()),
                table: Some("ACCOUNTS".into()),
                primary_key: Some(HashMap::from([("ID".into(), json!(1))])),
                ..Default::default()
            },
            vec![change("STATUS", json!("ACTIVE"))],
        ),
    );
    let insert_plan = default_data_edit_plan(
        &connection("oracle", "sql", false),
        &experience(&["insert-row"], true),
        &request(
            "insert-row",
            DataEditTarget {
                object_kind: "row".into(),
                schema: Some("APP".into()),
                table: Some("ACCOUNTS".into()),
                ..Default::default()
            },
            vec![change("ACCOUNT_NAME", json!("DataPad++ Labs"))],
        ),
    );

    assert_eq!(update_plan.execution_support, "live");
    assert_eq!(update_plan.plan.request_language, "sql");
    assert!(update_plan
        .plan
        .generated_request
        .contains("-- Before evidence (bounded primary-key or ROWID prefetch)"));
    assert!(update_plan
        .plan
        .generated_request
        .contains("update \"APP\".\"ACCOUNTS\" set \"STATUS\" = :p1 where \"ID\" = :p2;"));
    assert!(update_plan
        .plan
        .generated_request
        .contains("fetch first 2 rows only"));
    assert!(insert_plan
        .plan
        .generated_request
        .contains("variable datapad_rowid varchar2(32)"));
    assert!(insert_plan
        .plan
        .generated_request
        .contains("returning rowid into :datapad_rowid"));
    assert!(insert_plan
        .plan
        .generated_request
        .contains("chartorowid(:datapad_rowid)"));
}

#[test]
fn mongo_nested_rename_and_unset_requests_are_operation_specific() {
    let connection = connection("mongodb", "document", false);
    let experience = experience(&["rename-field", "unset-field"], true);
    let target = DataEditTarget {
        object_kind: "document".into(),
        collection: Some("products".into()),
        document_id: Some(json!("item-1")),
        ..Default::default()
    };
    let rename = request(
        "rename-field",
        target.clone(),
        vec![DataEditChange {
            path: Some(vec!["metadata".into(), "sku".into()]),
            new_name: Some("metadata.stockKeepingUnit".into()),
            ..Default::default()
        }],
    );
    let unset = request(
        "unset-field",
        target,
        vec![DataEditChange {
            path: Some(vec!["metadata".into(), "legacyFlag".into()]),
            ..Default::default()
        }],
    );

    let rename_plan = default_data_edit_plan(&connection, &experience, &rename);
    let unset_plan = default_data_edit_plan(&connection, &experience, &unset);

    assert!(rename_plan.plan.generated_request.contains("\"$rename\""));
    assert!(rename_plan
        .plan
        .generated_request
        .contains("\"metadata.sku\": \"metadata.stockKeepingUnit\""));
    assert!(unset_plan.plan.generated_request.contains("\"$unset\""));
    assert!(unset_plan
        .plan
        .generated_request
        .contains("\"metadata.legacyFlag\": \"\""));
}

#[test]
fn mongo_insert_document_preview_does_not_require_existing_document_id() {
    let connection = connection("mongodb", "document", false);
    let experience = experience(&["insert-document"], true);
    let plan = default_data_edit_plan(
        &connection,
        &experience,
        &request(
            "insert-document",
            DataEditTarget {
                object_kind: "document".into(),
                database: Some("catalog".into()),
                collection: Some("products".into()),
                ..Default::default()
            },
            vec![DataEditChange {
                value: Some(json!({
                    "sku": "nova",
                    "name": "Nova Chair"
                })),
                value_type: Some("json".into()),
                ..Default::default()
            }],
        ),
    );

    assert_eq!(plan.execution_support, "live");
    assert!(plan
        .plan
        .generated_request
        .contains("\"operation\": \"insertOne\""));
    assert!(plan
        .plan
        .generated_request
        .contains("\"database\": \"catalog\""));
    assert!(plan.plan.generated_request.contains("\"sku\": \"nova\""));
    assert!(!plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("stable document id")));
    assert_eq!(
        plan.plan.required_permissions,
        vec!["insert collection document"]
    );
}

#[test]
fn mongo_replace_and_delete_document_previews_are_operation_specific() {
    let connection = connection("mongodb", "document", false);
    let experience = experience(&["update-document", "delete-document"], true);
    let target = DataEditTarget {
        object_kind: "document".into(),
        database: Some("catalog".into()),
        collection: Some("products".into()),
        document_id: Some(json!("item-1")),
        ..Default::default()
    };

    let replace_plan = default_data_edit_plan(
        &connection,
        &experience,
        &request(
            "update-document",
            target.clone(),
            vec![DataEditChange {
                value: Some(json!({
                    "_id": "item-1",
                    "sku": "nova",
                    "name": "Nova Chair"
                })),
                value_type: Some("json".into()),
                ..Default::default()
            }],
        ),
    );
    let replace_request: serde_json::Value =
        serde_json::from_str(&replace_plan.plan.generated_request).expect("replace JSON");

    assert_eq!(replace_plan.execution_support, "live");
    assert_eq!(replace_request["operation"], "replaceOne");
    assert_eq!(replace_request["filter"]["_id"], "item-1");
    assert_eq!(replace_request["replacement"]["sku"], "nova");

    let delete_plan = default_data_edit_plan(
        &connection,
        &experience,
        &request("delete-document", target, vec![]),
    );
    let delete_request: serde_json::Value =
        serde_json::from_str(&delete_plan.plan.generated_request).expect("delete JSON");

    assert!(delete_plan.plan.destructive);
    assert_eq!(
        delete_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM MONGODB DELETE-DOCUMENT")
    );
    assert_eq!(delete_request["operation"], "deleteOne");
    assert_eq!(delete_request["filter"]["_id"], "item-1");
}

#[test]
fn litedb_document_crud_previews_use_sidecar_json_with_evidence_requests() {
    let connection = connection("litedb", "document", false);
    let experience = experience(
        &["insert-document", "update-document", "delete-document"],
        true,
    );
    let target = DataEditTarget {
        object_kind: "document".into(),
        collection: Some("products".into()),
        document_id: Some(json!(42)),
        ..Default::default()
    };

    let update_plan = default_data_edit_plan(
        &connection,
        &experience,
        &request(
            "update-document",
            target.clone(),
            vec![DataEditChange {
                value: Some(json!({
                    "_id": 42,
                    "sku": "tea-042",
                    "category": "pantry"
                })),
                value_type: Some("json".into()),
                ..Default::default()
            }],
        ),
    );
    let update_request: serde_json::Value =
        serde_json::from_str(&update_plan.plan.generated_request).expect("LiteDB JSON");

    assert_eq!(update_plan.execution_support, "live");
    assert_eq!(update_plan.plan.request_language, "json");
    assert_eq!(update_request["operation"], "UpdateDocument");
    assert_eq!(update_request["collection"], "products");
    assert_eq!(
        update_request["evidenceRequests"]["before"]["operation"],
        "FindById"
    );
    assert_eq!(update_request["evidenceRequests"]["after"]["id"], 42);

    let delete_plan = default_data_edit_plan(
        &connection,
        &experience,
        &request("delete-document", target, vec![]),
    );
    let delete_request: serde_json::Value =
        serde_json::from_str(&delete_plan.plan.generated_request).expect("LiteDB delete JSON");

    assert!(delete_plan.plan.destructive);
    assert_eq!(delete_request["operation"], "DeleteDocument");
    assert_eq!(delete_request["id"], 42);
}

#[test]
fn data_edit_previews_redact_secret_shaped_values() {
    let mongo_plan = default_data_edit_plan(
        &connection("mongodb", "document", false),
        &experience(&["insert-document"], true),
        &request(
            "insert-document",
            DataEditTarget {
                object_kind: "document".into(),
                collection: Some("users".into()),
                ..Default::default()
            },
            vec![DataEditChange {
                value: Some(json!({
                    "username": "testuser",
                    "password": "open-sesame",
                    "token": "abc123"
                })),
                value_type: Some("json".into()),
                ..Default::default()
            }],
        ),
    );
    let redis_plan = default_data_edit_plan(
        &connection("redis", "keyvalue", false),
        &experience(&["hash-set-field"], true),
        &request(
            "hash-set-field",
            DataEditTarget {
                object_kind: "key".into(),
                key: Some("account:1".into()),
                ..Default::default()
            },
            vec![change("password", json!("open-sesame"))],
        ),
    );
    let dynamo_plan = default_data_edit_plan(
        &connection("dynamodb", "widecolumn", false),
        &experience(&["update-item"], true),
        &request(
            "update-item",
            DataEditTarget {
                object_kind: "item".into(),
                table: Some("users".into()),
                item_key: Some(HashMap::from([("pk".into(), json!("USER#1"))])),
                ..Default::default()
            },
            vec![change("accessToken", json!("abc123"))],
        ),
    );

    for plan in [&mongo_plan, &redis_plan, &dynamo_plan] {
        assert!(!plan.plan.generated_request.contains("open-sesame"));
        assert!(!plan.plan.generated_request.contains("abc123"));
    }
    assert!(mongo_plan
        .plan
        .generated_request
        .contains("\"password\": \"********\""));
    assert_eq!(
        redis_plan.plan.generated_request,
        "HSET account:1 password ********"
    );
    assert!(dynamo_plan
        .plan
        .generated_request
        .contains("\":value\": \"********\""));
}

#[test]
fn keyvalue_delete_is_destructive_and_confirmation_gated() {
    let connection = connection("redis", "keyvalue", false);
    let plan = default_data_edit_plan(
        &connection,
        &experience(&["delete-key"], true),
        &request(
            "delete-key",
            DataEditTarget {
                object_kind: "key".into(),
                key: Some("session:1".into()),
                ..Default::default()
            },
            vec![],
        ),
    );

    assert_eq!(plan.plan.generated_request, "DEL session:1");
    assert!(plan.plan.destructive);
    assert_eq!(
        plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM REDIS DELETE-KEY")
    );
}

#[test]
fn keyvalue_rename_and_persist_ttl_generate_native_commands() {
    let connection = connection("redis", "keyvalue", false);
    let rename_plan = default_data_edit_plan(
        &connection,
        &experience(&["rename-key", "persist-ttl"], true),
        &request(
            "rename-key",
            DataEditTarget {
                object_kind: "key".into(),
                key: Some("session:1".into()),
                ..Default::default()
            },
            vec![DataEditChange {
                field: Some("session:1".into()),
                new_name: Some("session:renamed".into()),
                ..Default::default()
            }],
        ),
    );
    let persist_plan = default_data_edit_plan(
        &connection,
        &experience(&["rename-key", "persist-ttl"], true),
        &request(
            "persist-ttl",
            DataEditTarget {
                object_kind: "key".into(),
                key: Some("session:1".into()),
                ..Default::default()
            },
            vec![],
        ),
    );

    assert_eq!(
        rename_plan.plan.generated_request,
        "RENAME session:1 session:renamed"
    );
    assert_eq!(persist_plan.plan.generated_request, "PERSIST session:1");
    assert!(!rename_plan.plan.destructive);
    assert!(!persist_plan.plan.destructive);
}

#[test]
fn redis_json_path_edits_generate_native_commands_and_delete_guardrails() {
    let connection = connection("redis", "keyvalue", false);
    let target = DataEditTarget {
        object_kind: "json-path".into(),
        key: Some("profile:1".into()),
        ..Default::default()
    };
    let set_plan = default_data_edit_plan(
        &connection,
        &experience(&["json-set-path", "json-delete-path"], true),
        &request(
            "json-set-path",
            target.clone(),
            vec![DataEditChange {
                field: Some("$.profile.name".into()),
                value: Some(json!("Avery")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
        ),
    );
    let delete_plan = default_data_edit_plan(
        &connection,
        &experience(&["json-set-path", "json-delete-path"], true),
        &request(
            "json-delete-path",
            target,
            vec![DataEditChange {
                path: Some(vec!["profile".into(), "legacy flag".into()]),
                ..Default::default()
            }],
        ),
    );

    assert_eq!(
        set_plan.plan.generated_request,
        r#"JSON.SET profile:1 $.profile.name "Avery""#
    );
    assert_eq!(
        delete_plan.plan.generated_request,
        r#"JSON.DEL profile:1 $.profile["legacy flag"]"#
    );
    assert!(delete_plan.plan.destructive);
    assert_eq!(
        delete_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM REDIS JSON-DELETE-PATH")
    );
}

#[test]
fn redis_stream_entry_edits_generate_native_commands_and_delete_guardrails() {
    let connection = connection("redis", "keyvalue", false);
    let target = DataEditTarget {
        object_kind: "stream-entry".into(),
        key: Some("orders:stream".into()),
        document_id: Some(json!("1714670000000-0")),
        ..Default::default()
    };
    let add_plan = default_data_edit_plan(
        &connection,
        &experience(&["stream-add-entry", "stream-delete-entry"], true),
        &request(
            "stream-add-entry",
            target.clone(),
            vec![DataEditChange {
                value: Some(json!({
                    "event": "checkout",
                    "api_token": "secret-value",
                })),
                value_type: Some("object".into()),
                ..Default::default()
            }],
        ),
    );
    let delete_plan = default_data_edit_plan(
        &connection,
        &experience(&["stream-add-entry", "stream-delete-entry"], true),
        &request(
            "stream-delete-entry",
            target,
            vec![DataEditChange {
                field: Some("1714670000001-0".into()),
                ..Default::default()
            }],
        ),
    );

    assert_eq!(
        add_plan.plan.generated_request,
        "XADD orders:stream 1714670000000-0 event checkout api_token ********"
    );
    assert_eq!(
        delete_plan.plan.generated_request,
        "XDEL orders:stream 1714670000000-0 1714670000001-0"
    );
    assert!(delete_plan.plan.destructive);
    assert_eq!(
        delete_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM REDIS STREAM-DELETE-ENTRY")
    );
}

#[test]
fn redis_timeseries_sample_edits_generate_native_commands_and_delete_guardrails() {
    let connection = connection("redis", "keyvalue", false);
    let target = DataEditTarget {
        object_kind: "timeseries-sample".into(),
        key: Some("metrics:cpu".into()),
        document_id: Some(json!(1714670000000_i64)),
        ..Default::default()
    };
    let add_plan = default_data_edit_plan(
        &connection,
        &experience(&["timeseries-add-sample", "timeseries-delete-sample"], true),
        &request(
            "timeseries-add-sample",
            target.clone(),
            vec![DataEditChange {
                value: Some(json!(42.5)),
                value_type: Some("number".into()),
                ..Default::default()
            }],
        ),
    );
    let delete_plan = default_data_edit_plan(
        &connection,
        &experience(&["timeseries-add-sample", "timeseries-delete-sample"], true),
        &request(
            "timeseries-delete-sample",
            DataEditTarget {
                object_kind: "timeseries-sample".into(),
                key: Some("metrics:cpu".into()),
                ..Default::default()
            },
            vec![DataEditChange {
                path: Some(vec!["1714670000000".into(), "1714670060000".into()]),
                ..Default::default()
            }],
        ),
    );

    assert_eq!(
        add_plan.plan.generated_request,
        "TS.ADD metrics:cpu 1714670000000 42.5"
    );
    assert_eq!(
        delete_plan.plan.generated_request,
        "TS.DEL metrics:cpu 1714670000000 1714670060000"
    );
    assert!(delete_plan.plan.destructive);
    assert_eq!(
        delete_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM REDIS TIMESERIES-DELETE-SAMPLE")
    );
}

#[test]
fn redis_vector_member_edits_generate_native_commands_and_delete_guardrails() {
    let connection = connection("redis", "keyvalue", false);
    let target = DataEditTarget {
        object_kind: "vector-member".into(),
        key: Some("embeddings:articles".into()),
        document_id: Some(json!("doc:1")),
        ..Default::default()
    };
    let edit_kinds = [
        "vector-add-member",
        "vector-remove-member",
        "vector-set-attributes",
    ];
    let add_plan = default_data_edit_plan(
        &connection,
        &experience(&edit_kinds, true),
        &request(
            "vector-add-member",
            target.clone(),
            vec![DataEditChange {
                value: Some(json!({
                    "vector": [0.1, 1.2, 0.5],
                    "attributes": { "category": "docs" }
                })),
                value_type: Some("object".into()),
                ..Default::default()
            }],
        ),
    );
    let remove_plan = default_data_edit_plan(
        &connection,
        &experience(&edit_kinds, true),
        &request("vector-remove-member", target.clone(), vec![]),
    );
    let attributes_plan = default_data_edit_plan(
        &connection,
        &experience(&edit_kinds, true),
        &request(
            "vector-set-attributes",
            target,
            vec![DataEditChange {
                value: Some(json!({
                    "category": "reference",
                    "year": 2026
                })),
                value_type: Some("object".into()),
                ..Default::default()
            }],
        ),
    );

    assert_eq!(
        add_plan.plan.generated_request,
        r#"VADD embeddings:articles VALUES 3 0.1 1.2 0.5 doc:1 SETATTR {"category":"docs"}"#
    );
    assert_eq!(
        remove_plan.plan.generated_request,
        "VREM embeddings:articles doc:1"
    );
    assert_eq!(
        attributes_plan.plan.generated_request,
        r#"VSETATTR embeddings:articles doc:1 {"category":"reference","year":2026}"#
    );
    assert!(remove_plan.plan.destructive);
    assert_eq!(
        remove_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM REDIS VECTOR-REMOVE-MEMBER")
    );
}

#[test]
fn dynamodb_delete_item_is_destructive_and_confirmation_gated() {
    let connection = connection("dynamodb", "widecolumn", false);
    let plan = default_data_edit_plan(
        &connection,
        &experience(&["delete-item"], true),
        &request(
            "delete-item",
            DataEditTarget {
                object_kind: "item".into(),
                table: Some("orders".into()),
                item_key: Some(HashMap::from([("order_id".into(), json!("101"))])),
                ..Default::default()
            },
            vec![],
        ),
    );

    assert!(plan.plan.destructive);
    assert_eq!(
        plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM DYNAMODB DELETE-ITEM")
    );
    let generated: serde_json::Value =
        serde_json::from_str(&plan.plan.generated_request).expect("DynamoDB preview JSON");
    assert_eq!(generated["Operation"], "DeleteItem");
    assert_eq!(generated["ConditionExpression"], "attribute_exists(#key0)");
    assert_eq!(generated["ExpressionAttributeNames"]["#key0"], "order_id");
    assert_eq!(generated["ReturnValues"], "ALL_OLD");
    assert_eq!(generated["ReturnConsumedCapacity"], "TOTAL");
    assert_eq!(
        generated["EvidenceRequests"]["Before"]["Operation"],
        "GetItem"
    );
    assert_eq!(
        generated["EvidenceRequests"]["Before"]["ConsistentRead"],
        true
    );
    assert_eq!(
        generated["EvidenceRequests"]["After"]["ReturnConsumedCapacity"],
        "TOTAL"
    );
    assert!(plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("before/after evidence")));
}

#[test]
fn search_document_preview_uses_http_shape_and_delete_guardrails() {
    let update_plan = default_data_edit_plan(
        &connection("elasticsearch", "search", false),
        &experience(&["update-document", "delete-document"], true),
        &request(
            "update-document",
            DataEditTarget {
                object_kind: "document".into(),
                table: Some("orders".into()),
                document_id: Some(json!("101")),
                ..Default::default()
            },
            vec![change("status", json!("fulfilled"))],
        ),
    );
    assert_eq!(update_plan.execution_support, "live");
    assert_eq!(update_plan.plan.request_language, "query-dsl");
    assert!(update_plan
        .plan
        .generated_request
        .contains("POST /orders/_update/101?refresh=true"));
    assert!(update_plan
        .plan
        .generated_request
        .contains("GET /orders/_doc/101?realtime=true"));
    assert!(update_plan
        .plan
        .generated_request
        .contains("before document evidence"));
    assert!(update_plan
        .plan
        .generated_request
        .contains("after document evidence"));

    let delete_plan = default_data_edit_plan(
        &connection("opensearch", "search", false),
        &experience(&["delete-document"], true),
        &request(
            "delete-document",
            DataEditTarget {
                object_kind: "document".into(),
                table: Some("orders".into()),
                document_id: Some(json!("101")),
                ..Default::default()
            },
            vec![],
        ),
    );
    assert!(delete_plan.plan.destructive);
    assert_eq!(
        delete_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM OPENSEARCH DELETE-DOCUMENT")
    );
}

#[tokio::test]
async fn live_capable_delete_still_requires_matching_confirmation() -> Result<(), CommandError> {
    let execution = default_data_edit_execution(
        &connection("postgresql", "sql", false),
        &experience(&["delete-row"], true),
        &DataEditExecutionRequest {
            connection_id: "conn-postgresql".into(),
            environment_id: "env-dev".into(),
            edit_kind: "delete-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                schema: Some("public".into()),
                table: Some("accounts".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(1))])),
                ..Default::default()
            },
            changes: vec![],
            confirmation_text: None,
        },
    )
    .await?;

    assert!(!execution.executed);
    assert!(execution
        .warnings
        .iter()
        .any(|warning| warning.contains("needs confirmation before it can run")));
    Ok(())
}

#[test]
fn widecolumn_edits_warn_until_key_conditions_are_complete() {
    let plan = default_data_edit_plan(
        &connection("cassandra", "widecolumn", false),
        &experience(&["update-row"], true),
        &request(
            "update-row",
            DataEditTarget {
                object_kind: "row".into(),
                schema: Some("commerce".into()),
                table: Some("orders".into()),
                ..Default::default()
            },
            vec![change("status", json!("paid"))],
        ),
    );

    assert!(plan
        .plan
        .generated_request
        .contains("where <complete_primary_key> = ?;"));
    assert!(plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("complete key conditions")));
}

fn connection(engine: &str, family: &str, read_only: bool) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: format!("conn-{engine}"),
        name: format!("Fixture {engine}"),
        engine: engine.into(),
        family: family.into(),
        host: "127.0.0.1".into(),
        port: None,
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
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only,
    }
}

fn experience(edit_kinds: &[&str], live_execution: bool) -> DatastoreExperienceManifest {
    DatastoreExperienceManifest {
        engine: "fixture".into(),
        family: "fixture".into(),
        label: "Fixture".into(),
        maturity: "mvp".into(),
        object_kinds: Vec::new(),
        context_actions: Vec::new(),
        query_builders: Vec::new(),
        editable_scopes: vec![DatastoreEditableScope {
            scope: "object".into(),
            label: "Object".into(),
            edit_kinds: edit_kinds.iter().map(|kind| (*kind).into()).collect(),
            requires_primary_key: true,
            live_execution,
        }],
        diagnostics_tabs: Vec::new(),
        result_renderers: Vec::new(),
        safety_rules: Vec::new(),
        tree: None,
        test_templates: Vec::new(),
        test_assertions: Vec::new(),
    }
}

fn request(
    edit_kind: &str,
    target: DataEditTarget,
    changes: Vec<DataEditChange>,
) -> DataEditPlanRequest {
    DataEditPlanRequest {
        connection_id: "conn-fixture".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target,
        changes,
    }
}

fn change(field: &str, value: serde_json::Value) -> DataEditChange {
    DataEditChange {
        field: Some(field.into()),
        value: Some(value),
        ..Default::default()
    }
}

#[test]
fn affected_row_outcomes_require_a_match_only_for_deletes() {
    assert!(!affected_rows_edit_executed("delete-row", 0));
    assert!(affected_rows_edit_executed("delete-row", 1));
    assert!(affected_rows_edit_executed("update-row", 0));
}
