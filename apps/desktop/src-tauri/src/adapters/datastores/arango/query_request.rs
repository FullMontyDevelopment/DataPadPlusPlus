use serde_json::{json, Map, Value};

use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ArangoQueryRequest {
    pub(super) query: String,
    pub(super) cursor_body: String,
    pub(super) explain_body: String,
    pub(super) mode: &'static str,
    pub(super) fetch_limit: u32,
}

pub(super) fn arango_query_request(
    query_text: &str,
    execute_mode: &str,
    row_limit: u32,
) -> Result<ArangoQueryRequest, CommandError> {
    let fetch_limit = row_limit.saturating_add(1);
    let spec = parse_arango_query_spec(query_text)?;
    let (query, bind_vars, user_options) = match spec {
        Some(value) => {
            let query = value
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|query| !query.is_empty())
                .ok_or_else(|| {
                    CommandError::new(
                        "arango-query-spec-invalid",
                        "ArangoDB structured query JSON must include a non-empty query string.",
                    )
                })?;
            (
                query.to_string(),
                value.get("bindVars").cloned().unwrap_or_else(|| json!({})),
                value.get("options").cloned().unwrap_or_else(|| json!({})),
            )
        }
        None => (query_text.trim().to_string(), json!({}), json!({})),
    };

    if !is_read_only_aql(&query) {
        return Err(CommandError::new(
            "arango-write-preview-only",
            "ArangoDB writes, imports, and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = if execute_mode == "explain" {
        "explain"
    } else {
        "read"
    };
    Ok(ArangoQueryRequest {
        cursor_body: arango_cursor_body(&query, &bind_vars, &user_options, fetch_limit),
        explain_body: arango_explain_body(&query, &bind_vars, &user_options),
        query,
        mode,
        fetch_limit,
    })
}

pub(super) fn is_read_only_aql(query: &str) -> bool {
    let tokens = aql_tokens(query);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert" | "update" | "replace" | "remove" | "upsert"
        )
    }) {
        return false;
    }
    matches!(
        tokens.first().map(String::as_str),
        Some("for" | "return" | "let" | "with" | "collect")
    )
}

fn parse_arango_query_spec(query_text: &str) -> Result<Option<Value>, CommandError> {
    if !query_text.trim_start().starts_with('{') {
        return Ok(None);
    }
    let value = serde_json::from_str::<Value>(query_text).map_err(|error| {
        CommandError::new(
            "arango-query-spec-invalid",
            format!("ArangoDB structured query JSON is invalid: {error}"),
        )
    })?;
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if !object.contains_key("query") {
        return Err(CommandError::new(
            "arango-query-spec-invalid",
            "ArangoDB structured query JSON must include query.",
        ));
    }
    Ok(Some(value))
}

fn arango_cursor_body(
    query: &str,
    bind_vars: &Value,
    user_options: &Value,
    fetch_limit: u32,
) -> String {
    let options = arango_safe_options(user_options);
    serde_json::to_string(&json!({
        "query": query,
        "bindVars": bind_vars,
        "count": true,
        "batchSize": fetch_limit,
        "options": options,
    }))
    .unwrap_or_default()
}

fn arango_explain_body(query: &str, bind_vars: &Value, user_options: &Value) -> String {
    let mut options = arango_safe_options(user_options);
    options["allPlans"] = json!(false);
    serde_json::to_string(&json!({
        "query": query,
        "bindVars": bind_vars,
        "options": options,
    }))
    .unwrap_or_default()
}

fn arango_safe_options(user_options: &Value) -> Value {
    let mut options = user_options.as_object().cloned().unwrap_or_else(Map::new);
    options.insert("fullCount".into(), json!(true));
    options.remove("stream");
    Value::Object(options)
}

fn aql_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = query.chars().peekable();
    let mut in_string: Option<char> = None;

    while let Some(character) = chars.next() {
        if let Some(quote) = in_string {
            if character == '\\' {
                let _ = chars.next();
                continue;
            }
            if character == quote {
                in_string = None;
            }
            continue;
        }

        if character == '\'' || character == '"' || character == '`' {
            flush_token(&mut token, &mut tokens);
            in_string = Some(character);
            continue;
        }
        if character == '/' && chars.peek() == Some(&'/') {
            flush_token(&mut token, &mut tokens);
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if character.is_ascii_alphanumeric() || character == '_' {
            token.push(character.to_ascii_lowercase());
        } else {
            flush_token(&mut token, &mut tokens);
        }
    }
    flush_token(&mut token, &mut tokens);
    tokens
}

fn flush_token(token: &mut String, tokens: &mut Vec<String>) {
    if !token.is_empty() {
        tokens.push(std::mem::take(token));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{arango_query_request, is_read_only_aql};

    #[test]
    fn arango_raw_aql_builds_bounded_cursor_body() {
        let request = arango_query_request("FOR doc IN users RETURN doc", "full", 25).unwrap();
        let value: serde_json::Value = serde_json::from_str(&request.cursor_body).unwrap();

        assert_eq!(request.mode, "read");
        assert_eq!(request.fetch_limit, 26);
        assert_eq!(value["query"], "FOR doc IN users RETURN doc");
        assert_eq!(value["batchSize"], 26);
        assert_eq!(value["options"]["fullCount"], true);
    }

    #[test]
    fn arango_structured_query_preserves_bind_vars_and_safe_options() {
        let request = arango_query_request(
            r#"{ "query": "FOR doc IN users FILTER doc.age > @age RETURN doc", "bindVars": { "age": 30 }, "options": { "stream": true, "maxPlans": 4 } }"#,
            "full",
            10,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&request.cursor_body).unwrap();

        assert_eq!(value["bindVars"], json!({ "age": 30 }));
        assert_eq!(value["options"]["maxPlans"], 4);
        assert!(value["options"].get("stream").is_none());
    }

    #[test]
    fn arango_explain_mode_builds_explain_body() {
        let request = arango_query_request("FOR doc IN users RETURN doc", "explain", 10).unwrap();
        let value: serde_json::Value = serde_json::from_str(&request.explain_body).unwrap();

        assert_eq!(request.mode, "explain");
        assert_eq!(value["query"], "FOR doc IN users RETURN doc");
        assert_eq!(value["options"]["allPlans"], false);
    }

    #[test]
    fn arango_read_only_guard_blocks_mutating_aql() {
        assert!(is_read_only_aql("FOR doc IN users RETURN doc"));
        assert!(is_read_only_aql("LET docs = [] RETURN docs"));
        assert!(!is_read_only_aql("INSERT { name: 'Ada' } INTO users"));
        assert!(!is_read_only_aql(
            "FOR doc IN users UPDATE doc WITH { active: true } IN users"
        ));
        assert!(!is_read_only_aql("FOR doc IN users REMOVE doc IN users"));
    }

    #[test]
    fn arango_read_only_guard_ignores_keywords_inside_strings_and_comments() {
        assert!(is_read_only_aql("FOR doc IN users RETURN 'REMOVE'"));
        assert!(is_read_only_aql(
            "FOR doc IN users // REMOVE later\nRETURN doc"
        ));
    }

    #[test]
    fn arango_query_request_rejects_mutating_aql() {
        let error =
            arango_query_request("FOR doc IN users REMOVE doc IN users", "full", 10).unwrap_err();

        assert_eq!(error.code, "arango-write-preview-only");
    }
}
