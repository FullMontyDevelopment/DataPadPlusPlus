use super::*;
use serde_json::json;

fn stored_plan(
    expires_at: Instant,
    fingerprint: &str,
    status: &str,
    confirmation_text: Option<&str>,
) -> StoredPlan {
    StoredPlan {
        expires_at,
        fingerprint: fingerprint.into(),
        status: status.into(),
        confirmation_text: confirmation_text.map(str::to_string),
    }
}

#[test]
fn plan_validation_rejects_expired_stale_blocked_and_inexact_confirmations() {
    let now = Instant::now();

    let expired = validate_stored_plan(
        stored_plan(now, "revision", "ready", None),
        "revision",
        None,
        now,
    )
    .unwrap_err();
    assert_eq!(expired.code, "test-plan-expired");

    let stale = validate_stored_plan(
        stored_plan(now + PLAN_TTL, "old-revision", "ready", None),
        "new-revision",
        None,
        now,
    )
    .unwrap_err();
    assert_eq!(stale.code, "test-plan-stale");

    let blocked = validate_stored_plan(
        stored_plan(now + PLAN_TTL, "revision", "blocked", None),
        "revision",
        None,
        now,
    )
    .unwrap_err();
    assert_eq!(blocked.code, "test-plan-blocked");

    let confirmation = validate_stored_plan(
        stored_plan(
            now + PLAN_TTL,
            "revision",
            "confirm",
            Some("CONFIRM TEST RUN suite-1"),
        ),
        "revision",
        Some("confirm test run suite-1"),
        now,
    )
    .unwrap_err();
    assert_eq!(confirmation.code, "test-plan-confirmation-invalid");
}

#[test]
fn plan_validation_accepts_the_bound_revision_and_exact_confirmation() {
    let now = Instant::now();
    validate_stored_plan(
        stored_plan(
            now + PLAN_TTL,
            "revision",
            "confirm",
            Some("CONFIRM TEST RUN suite-1"),
        ),
        "revision",
        Some("CONFIRM TEST RUN suite-1"),
        now,
    )
    .unwrap();
}

#[test]
fn consuming_a_plan_is_single_use() {
    let plan_id = format!("test-plan-single-use-{}", std::process::id());
    plans().unwrap().insert(
        plan_id.clone(),
        stored_plan(Instant::now() + PLAN_TTL, "revision", "ready", None),
    );

    consume_plan(&plan_id).unwrap();
    let reused = consume_plan(&plan_id).unwrap_err();
    assert_eq!(reused.code, "test-plan-invalid");
}

#[test]
fn suite_variables_replace_repeated_tokens_without_resolving_other_templates() {
    let variables = serde_json::Map::from_iter([
        ("LIMIT".into(), json!(25)),
        ("TABLE".into(), json!("orders")),
    ]);

    assert_eq!(
        resolve_suite_variables(
            "select * from {{TABLE}} limit {{LIMIT}} /* {{LIMIT}} {{SECRET}} */",
            &variables,
        ),
        "select * from orders limit 25 /* 25 {{SECRET}} */"
    );
}
