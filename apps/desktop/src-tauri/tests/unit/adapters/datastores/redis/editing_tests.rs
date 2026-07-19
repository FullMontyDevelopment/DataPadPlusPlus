use crate::domain::models::DataEditTarget;

use super::*;

fn request(edit_kind: &str, key: Option<&str>, value: Option<Value>) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "key".into(),
            key: key.map(str::to_string),
            ..Default::default()
        },
        changes: value
            .map(|value| {
                vec![DataEditChange {
                    value: Some(value),
                    ..Default::default()
                }]
            })
            .unwrap_or_default(),
        confirmation_text: None,
    }
}

#[test]
fn ttl_seconds_accepts_positive_string_or_number_values() {
    assert_eq!(
        ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!(60)))),
        Some(60)
    );
    assert_eq!(
        ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!("120")))),
        Some(120)
    );
    assert_eq!(
        ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!(0)))),
        None
    );
    assert_eq!(
        ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!("soon")))),
        None
    );
}

#[test]
fn redis_value_preserves_strings_and_serializes_structured_values() {
    assert_eq!(redis_value(&json!("active")), "active");
    assert_eq!(
        redis_value(&json!({"enabled": true})),
        r#"{"enabled":true}"#
    );
}

#[test]
fn redis_json_paths_accept_jsonpath_or_segments() {
    let direct = DataEditChange {
        field: Some("$.profile.name".into()),
        ..Default::default()
    };
    let segmented = DataEditChange {
        path: Some(vec!["profile".into(), "roles".into(), "0".into()]),
        ..Default::default()
    };
    let quoted = DataEditChange {
        path: Some(vec!["profile data".into(), "api.token".into()]),
        ..Default::default()
    };

    assert_eq!(redis_json_path(&direct), "$.profile.name");
    assert_eq!(redis_json_path(&segmented), "$.profile.roles[0]");
    assert_eq!(
        redis_json_path(&quoted),
        r#"$["profile data"]["api.token"]"#
    );
}

#[test]
fn redis_json_value_serializes_strings_as_json_strings() {
    assert_eq!(redis_json_value(&json!("active")).unwrap(), r#""active""#);
    assert_eq!(
        redis_json_value(&json!({"enabled": true})).unwrap(),
        r#"{"enabled":true}"#
    );
    assert_eq!(normalize_redis_type("ReJSON-RL"), "json");
}

#[test]
fn stream_entry_helpers_extract_ids_and_field_values() {
    let mut add = request(
        "stream-add-entry",
        Some("orders:stream"),
        Some(json!({
            "event": "checkout",
            "total": 42,
            "metadata": { "source": "web" }
        })),
    );
    add.target.document_id = Some(json!("1714670000000-0"));

    assert_eq!(stream_add_entry_id(&add), "1714670000000-0");
    assert_eq!(
        stream_entry_fields(&add),
        vec![
            ("event".into(), "checkout".into()),
            ("total".into(), "42".into()),
            ("metadata".into(), r#"{"source":"web"}"#.into()),
        ]
    );

    let delete = DataEditExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-dev".into(),
        edit_kind: "stream-delete-entry".into(),
        target: DataEditTarget {
            object_kind: "stream-entry".into(),
            key: Some("orders:stream".into()),
            document_id: Some(json!("1714670000000-0")),
            ..Default::default()
        },
        changes: vec![DataEditChange {
            field: Some("1714670000001-0".into()),
            ..Default::default()
        }],
        confirmation_text: None,
    };

    assert_eq!(
        stream_delete_entry_ids(&delete),
        vec!["1714670000000-0", "1714670000001-0"]
    );
}

#[test]
fn stream_entry_helpers_support_per_field_changes_and_auto_ids() {
    let edit = DataEditExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-dev".into(),
        edit_kind: "stream-add-entry".into(),
        target: DataEditTarget {
            object_kind: "stream-entry".into(),
            key: Some("orders:stream".into()),
            ..Default::default()
        },
        changes: vec![
            DataEditChange {
                field: Some("event".into()),
                value: Some(json!("paid")),
                ..Default::default()
            },
            DataEditChange {
                path: Some(vec!["amount".into()]),
                value: Some(json!(12.5)),
                ..Default::default()
            },
        ],
        confirmation_text: None,
    };

    assert_eq!(stream_add_entry_id(&edit), "*");
    assert_eq!(
        stream_entry_fields(&edit),
        vec![
            ("event".into(), "paid".into()),
            ("amount".into(), "12.5".into()),
        ]
    );
}

#[test]
fn timeseries_helpers_extract_sample_values_and_ranges() {
    let mut add = request(
        "timeseries-add-sample",
        Some("metrics:cpu"),
        Some(json!({ "value": "42.5" })),
    );
    add.target.object_kind = "timeseries-sample".into();
    add.target.document_id = Some(json!(1714670000000_i64));

    assert_eq!(timeseries_sample_timestamp(&add), "1714670000000");
    assert_eq!(timeseries_sample_value(&add), Some(42.5));

    let delete_single = DataEditExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-dev".into(),
        edit_kind: "timeseries-delete-sample".into(),
        target: DataEditTarget {
            object_kind: "timeseries-sample".into(),
            key: Some("metrics:cpu".into()),
            document_id: Some(json!("1714670000000")),
            ..Default::default()
        },
        changes: vec![],
        confirmation_text: None,
    };
    assert_eq!(
        timeseries_delete_range(&delete_single),
        Some((1714670000000, 1714670000000))
    );

    let delete_range = DataEditExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-dev".into(),
        edit_kind: "timeseries-delete-sample".into(),
        target: DataEditTarget {
            object_kind: "timeseries-sample".into(),
            key: Some("metrics:cpu".into()),
            ..Default::default()
        },
        changes: vec![DataEditChange {
            value: Some(json!({
                "from": 1714670000000_i64,
                "to": 1714670060000_i64,
            })),
            ..Default::default()
        }],
        confirmation_text: None,
    };
    assert_eq!(
        timeseries_delete_range(&delete_range),
        Some((1714670000000, 1714670060000))
    );
}

#[test]
fn vector_helpers_extract_members_vectors_and_attributes() {
    let mut add = request(
        "vector-add-member",
        Some("embeddings:articles"),
        Some(json!({
            "element": "doc:1",
            "vector": ["0.1", 1.2, 0.5],
            "attributes": {
                "category": "docs"
            }
        })),
    );
    add.target.object_kind = "vector-member".into();

    assert_eq!(vector_member_name(&add).as_deref(), Some("doc:1"));
    assert_eq!(vector_values(&add), Some(vec![0.1, 1.2, 0.5]));
    assert_eq!(
        vector_add_attributes(&add).unwrap().as_deref(),
        Some(r#"{"category":"docs"}"#)
    );

    let mut remove = request("vector-remove-member", Some("embeddings:articles"), None);
    remove.target.object_kind = "vector-member".into();
    remove.target.document_id = Some(json!("doc:1"));
    assert_eq!(vector_member_name(&remove).as_deref(), Some("doc:1"));

    let mut attributes = request(
        "vector-set-attributes",
        Some("embeddings:articles"),
        Some(json!({
            "category": "reference",
            "year": 2026
        })),
    );
    attributes.target.object_kind = "vector-member".into();
    attributes.target.document_id = Some(json!("doc:1"));
    assert_eq!(
        vector_attributes(&attributes).unwrap().as_deref(),
        Some(r#"{"category":"reference","year":2026}"#)
    );

    let mut remove_attributes = request(
        "vector-set-attributes",
        Some("embeddings:articles"),
        Some(json!("")),
    );
    remove_attributes.target.object_kind = "vector-member".into();
    remove_attributes.target.document_id = Some(json!("doc:1"));
    assert_eq!(
        vector_attributes(&remove_attributes).unwrap().as_deref(),
        Some("")
    );
}

#[test]
fn destructive_redis_edits_require_a_positive_removal_count() {
    for edit_kind in [
        "delete-key",
        "hash-delete-field",
        "json-delete-path",
        "stream-delete-entry",
        "timeseries-delete-sample",
    ] {
        assert_eq!(
            redis_destructive_edit_applied(edit_kind, &json!({ "deleted": 0 })),
            Some(false),
            "{edit_kind} should preserve an unmatched target"
        );
        assert_eq!(
            redis_destructive_edit_applied(edit_kind, &json!({ "deleted": 1 })),
            Some(true),
            "{edit_kind} should confirm a removed target"
        );
    }

    for edit_kind in [
        "list-remove-value",
        "set-remove-member",
        "zset-remove-member",
        "vector-remove-member",
    ] {
        assert_eq!(
            redis_destructive_edit_applied(edit_kind, &json!({ "removed": 0 })),
            Some(false),
            "{edit_kind} should preserve an unmatched target"
        );
        assert_eq!(
            redis_destructive_edit_applied(edit_kind, &json!({ "removed": 1 })),
            Some(true),
            "{edit_kind} should confirm a removed target"
        );
    }

    assert_eq!(
        redis_destructive_edit_applied("set-key-value", &json!({})),
        None
    );
}
