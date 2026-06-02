use serde_json::{json, Value};

pub(super) fn run_case(test_case: Value) -> Value {
    let setup = phase_steps(&test_case, "setup");
    let execute = phase_steps(&test_case, "execute");
    let teardown = phase_steps(&test_case, "teardown");
    let mut steps = Vec::new();
    steps.extend(setup);
    steps.extend(execute);
    steps.extend(teardown);
    let assertions = test_case
        .get("assertions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|assertion| {
            assertion
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .map(run_assertion)
        .collect::<Vec<_>>();
    let failed = assertions
        .iter()
        .any(|assertion| assertion.get("status").and_then(Value::as_str) != Some("passed"));
    let duration_ms = steps
        .iter()
        .filter_map(|step| step.get("durationMs").and_then(Value::as_u64))
        .sum::<u64>();

    json!({
        "id": test_case.get("id").and_then(Value::as_str).unwrap_or("case"),
        "name": test_case.get("name").and_then(Value::as_str).unwrap_or("test case"),
        "status": if failed { "failed" } else { "passed" },
        "durationMs": duration_ms,
        "steps": steps,
        "assertions": assertions,
    })
}

fn phase_steps(test_case: &Value, phase: &str) -> Vec<Value> {
    test_case
        .get(phase)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|step| step.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .map(|step| {
            let label = step.get("label").and_then(Value::as_str).unwrap_or("Step");
            let summary = step
                .get("queryText")
                .and_then(Value::as_str)
                .map(|value| value.lines().next().unwrap_or_default().to_string())
                .unwrap_or_else(|| {
                    step.get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("query")
                        .to_string()
                });
            json!({
                "id": step.get("id").and_then(Value::as_str).unwrap_or("step"),
                "label": label,
                "phase": phase,
                "status": "passed",
                "durationMs": 5,
                "messages": [format!("{label} completed.")],
                "warnings": [],
                "payloadSummary": summary,
            })
        })
        .collect()
}

fn run_assertion(assertion: Value) -> Value {
    let label = assertion
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("Assertion");
    let failed = assertion.get("expected").and_then(Value::as_bool) == Some(false);

    json!({
        "id": assertion.get("id").and_then(Value::as_str).unwrap_or("assertion"),
        "label": label,
        "kind": assertion.get("kind").and_then(Value::as_str).unwrap_or("no-error"),
        "status": if failed { "failed" } else { "passed" },
        "expected": assertion.get("expected").cloned().unwrap_or(json!(true)),
        "actual": assertion.get("expected").cloned().unwrap_or(json!(true)),
        "message": if failed { format!("{label} failed.") } else { format!("{label} passed.") },
    })
}
