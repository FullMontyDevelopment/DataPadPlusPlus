use super::*;

#[test]
fn comparisons_cover_equality_contains_ordering_and_exists() {
    assert!(compare(Some(&json!(3)), &json!(3), "equals"));
    assert!(compare(Some(&json!(3)), &json!(4), "not-equals"));
    assert!(compare(
        Some(&json!("orders-ready")),
        &json!("ready"),
        "contains"
    ));
    assert!(compare(Some(&json!(5)), &json!(4), "greater-than"));
    assert!(compare(Some(&json!(5)), &json!(5), "greater-than-or-equal"));
    assert!(compare(Some(&json!(4)), &json!(5), "less-than"));
    assert!(compare(Some(&json!(5)), &json!(5), "less-than-or-equal"));
    assert!(compare(Some(&Value::Null), &Value::Null, "exists"));
}

#[test]
fn observations_normalize_table_document_and_nested_payload_counts() {
    assert_eq!(
        count_observation(&json!({"payloads": [{"rows": [[1], [2]]}]})),
        Some(2)
    );
    assert_eq!(
        count_observation(&json!({"payloads": [{"documents": [{"id": 1}]}]})),
        Some(1)
    );
    assert_eq!(
        count_observation(&json!({"payloads": [{"hits": [{"_id": "a"}, {"_id": "b"}]}]})),
        Some(2)
    );
}

#[test]
fn status_aggregation_uses_the_documented_priority() {
    assert_eq!(aggregate_status(["passed", "failed"].into_iter()), "failed");
    assert_eq!(
        aggregate_status(["failed", "blocked"].into_iter()),
        "blocked"
    );
    assert_eq!(aggregate_status(["blocked", "error"].into_iter()), "error");
    assert_eq!(
        aggregate_status(["error", "canceled"].into_iter()),
        "canceled"
    );
}

#[test]
fn json_paths_support_object_fields_and_array_indexes() {
    let value = json!({"payloads": [{"rows": [{"id": 7}]}]});
    assert_eq!(
        value_at_path(&value, "$.payloads.0.rows.0.id").cloned(),
        Some(json!(7))
    );
}

#[test]
fn source_free_no_error_assertions_evaluate_the_whole_case() {
    let observations = HashMap::from([
        (
            "step-1".into(),
            StepObservation {
                duration_ms: 3,
                value: Some(json!({"rows": [1]})),
                error: None,
            },
        ),
        (
            "step-2".into(),
            StepObservation {
                duration_ms: 4,
                value: None,
                error: Some("failed".into()),
            },
        ),
    ]);

    let result = evaluate_assertion(
        json!({
            "id": "assert-1",
            "label": "case has an error",
            "kind": "no-error",
            "expected": false
        }),
        Some("step-1"),
        &observations,
        7,
    );

    assert_eq!(result["status"], "passed");
    assert_eq!(result["actual"], false);
}

#[test]
fn persisted_actual_values_are_bounded() {
    let value = Value::String("x".repeat(9_000));
    let bounded = bounded_value(Some(value), 128).unwrap();

    assert_eq!(bounded["truncated"], true);
}
