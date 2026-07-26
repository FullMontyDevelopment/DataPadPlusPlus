use serde_json::{json, Value};

use super::providers::DatastoreTestExecutionProvider;
use crate::domain::models::{ConnectionProfile, ScopedQueryTarget};

pub(super) fn test_suite_for_connection(
    connection: &ConnectionProfile,
    target: &ScopedQueryTarget,
    provider: &dyn DatastoreTestExecutionProvider,
) -> Value {
    let query_language = provider.query_language();
    let query_text = target
        .query_template
        .as_deref()
        .filter(|query| !query.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| provider.starter_query(connection, target));

    json!({
        "id": format!("{}-custom-suite", connection.engine),
        "name": format!("{} target test", connection.name),
        "description": format!("Repeatable smoke test for {}.", connection.name),
        "engine": connection.engine,
        "family": connection.family,
        "connectionId": connection.id,
        "scopedTarget": target,
        "inferredLanguage": query_language,
        "variables": {},
        "cases": [{
            "id": format!("{}-smoke-case", connection.engine),
            "name": "returns expected fixture data",
            "enabled": true,
            "timeoutMs": 30000,
            "setup": [],
            "execute": [{
                "id": format!("{}-execute-1", connection.engine),
                "label": "Execute read",
                "phase": "execute",
                "kind": "query",
                "enabled": true,
                "language": query_language,
                "queryText": query_text,
            }],
            "assertions": [{
                "id": format!("{}-assert-1", connection.engine),
                "label": "Expected result",
                "kind": "no-error",
                "enabled": true,
                "comparison": "equals",
                "expected": true,
            }],
            "teardown": [],
        }],
    })
}
