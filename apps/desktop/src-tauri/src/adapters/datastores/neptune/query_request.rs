use super::super::super::*;
use super::connection::{neptune_gremlin_body, percent_encode_form};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NeptuneQueryRequest {
    pub(super) language: &'static str,
    pub(super) mode: &'static str,
    pub(super) path: &'static str,
    pub(super) body: String,
    pub(super) accept: Option<&'static str>,
    pub(super) gremlin: Option<String>,
}

pub(super) fn neptune_query_request(
    language: &str,
    query_text: &str,
    execute_mode: &str,
) -> Result<NeptuneQueryRequest, CommandError> {
    let query = query_text.trim();
    if query.is_empty() {
        return Err(CommandError::new(
            "neptune-query-missing",
            "No Neptune graph query was provided.",
        ));
    }

    match language {
        "sparql" => sparql_query_request(query),
        "opencypher" | "cypher" => opencypher_query_request(query),
        _ => gremlin_query_request(query, execute_mode),
    }
}

fn gremlin_query_request(
    query: &str,
    execute_mode: &str,
) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_gremlin(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune writes, imports, schema changes, and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }
    let mode = match execute_mode {
        "explain" => "explain",
        "profile" => "profile",
        _ if gremlin_ends_with(query, "explain") => "explain",
        _ if gremlin_ends_with(query, "profile") => "profile",
        _ => "read",
    };
    let gremlin = decorate_gremlin_for_mode(query, mode);
    Ok(NeptuneQueryRequest {
        language: "gremlin",
        mode,
        path: "/gremlin",
        body: neptune_gremlin_body(&gremlin),
        accept: None,
        gremlin: Some(gremlin),
    })
}

fn opencypher_query_request(query: &str) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_opencypher(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune openCypher writes and schema changes are operation-plan preview only in this adapter phase.",
        ));
    }
    Ok(NeptuneQueryRequest {
        language: "opencypher",
        mode: "read",
        path: "/openCypher",
        body: format!("query={}", percent_encode_form(query)),
        accept: Some("application/json"),
        gremlin: None,
    })
}

fn sparql_query_request(query: &str) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_sparql(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune SPARQL updates, loads, and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }
    Ok(NeptuneQueryRequest {
        language: "sparql",
        mode: "read",
        path: "/sparql",
        body: format!("query={}", percent_encode_form(query)),
        accept: Some("application/sparql-results+json, application/json"),
        gremlin: None,
    })
}

pub(super) fn decorate_gremlin_for_mode(query: &str, mode: &str) -> String {
    let trimmed = query.trim().trim_end_matches(';');
    match mode {
        "explain" if trimmed.starts_with("g.") && !gremlin_ends_with(trimmed, "explain") => {
            format!("{trimmed}.explain()")
        }
        "profile" if trimmed.starts_with("g.") && !gremlin_ends_with(trimmed, "profile") => {
            format!("{trimmed}.profile()")
        }
        _ => trimmed.into(),
    }
}

pub(super) fn is_read_only_gremlin(query: &str) -> bool {
    let tokens = query_tokens(query);
    if tokens.is_empty() || tokens.first().map(String::as_str) != Some("g") {
        return false;
    }
    if query.trim().trim_end_matches(';').contains(';') {
        return false;
    }
    !tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "addv"
                | "adde"
                | "property"
                | "drop"
                | "mergev"
                | "mergee"
                | "io"
                | "read"
                | "write"
                | "program"
                | "sideeffect"
                | "withsideeffect"
                | "tx"
                | "commit"
                | "rollback"
        )
    })
}

pub(super) fn is_read_only_opencypher(query: &str) -> bool {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "create" | "merge" | "delete" | "detach" | "set" | "remove" | "load" | "call" | "use"
        )
    }) {
        return false;
    }
    matches!(
        tokens.first().map(String::as_str),
        Some("match" | "optional" | "return" | "with" | "unwind")
    )
}

pub(super) fn is_read_only_sparql(query: &str) -> bool {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert" | "delete" | "load" | "clear" | "create" | "drop" | "copy" | "move" | "add"
        )
    }) {
        return false;
    }
    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "ask" | "construct" | "describe" | "prefix" | "base")
    )
}

fn gremlin_ends_with(query: &str, step: &str) -> bool {
    let needle = format!(".{step}()");
    query
        .trim()
        .trim_end_matches(';')
        .to_ascii_lowercase()
        .ends_with(&needle)
}

fn query_tokens(query: &str) -> Vec<String> {
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
        if character == '#' {
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
    use super::{
        decorate_gremlin_for_mode, is_read_only_gremlin, is_read_only_opencypher,
        is_read_only_sparql, neptune_query_request,
    };

    #[test]
    fn neptune_gremlin_request_decorates_explain_and_profile_once() {
        let profile = neptune_query_request("gremlin", "g.V().limit(1)", "profile").unwrap();
        assert_eq!(profile.mode, "profile");
        assert_eq!(profile.gremlin.as_deref(), Some("g.V().limit(1).profile()"));

        let explain =
            neptune_query_request("gremlin", "g.V().limit(1).explain()", "explain").unwrap();
        assert_eq!(explain.gremlin.as_deref(), Some("g.V().limit(1).explain()"));

        assert_eq!(
            decorate_gremlin_for_mode("g.V().limit(1);", "explain"),
            "g.V().limit(1).explain()"
        );
    }

    #[test]
    fn neptune_read_only_guards_allow_native_reads() {
        assert!(is_read_only_gremlin("g.V().hasLabel('person').limit(25)"));
        assert!(is_read_only_opencypher("MATCH (n) RETURN n LIMIT 25"));
        assert!(is_read_only_sparql(
            "PREFIX ex: <urn:> SELECT ?s WHERE { ?s ?p ?o } LIMIT 25"
        ));
    }

    #[test]
    fn neptune_read_only_guards_block_mutations() {
        assert!(!is_read_only_gremlin("g.addV('person')"));
        assert!(!is_read_only_gremlin("g.V().drop()"));
        assert!(!is_read_only_opencypher("MATCH (n) DELETE n"));
        assert!(!is_read_only_opencypher("CREATE (:Person {name: 'Ada'})"));
        assert!(!is_read_only_sparql("DELETE WHERE { ?s ?p ?o }"));
        assert!(!is_read_only_sparql(
            "LOAD <s3://bucket/file.ttl> INTO GRAPH <urn:g>"
        ));
    }

    #[test]
    fn neptune_read_only_guards_ignore_keywords_in_strings_and_comments() {
        assert!(is_read_only_gremlin("g.V().has('name', 'drop')"));
        assert!(is_read_only_opencypher("MATCH (n) RETURN 'DELETE' AS text"));
        assert!(is_read_only_sparql(
            "SELECT ?s WHERE { ?s ?p \"DELETE\" } # DROP later"
        ));
    }

    #[test]
    fn neptune_query_request_builds_language_bodies() {
        let cypher = neptune_query_request("opencypher", "MATCH (n) RETURN n", "full").unwrap();
        assert_eq!(cypher.path, "/openCypher");
        assert!(cypher.body.starts_with("query=MATCH+"));

        let sparql =
            neptune_query_request("sparql", "SELECT ?s WHERE { ?s ?p ?o }", "full").unwrap();
        assert_eq!(sparql.path, "/sparql");
        assert!(sparql.body.starts_with("query=SELECT+"));
    }

    #[test]
    fn neptune_query_request_rejects_write_queries() {
        let error = neptune_query_request("gremlin", "g.addV('person')", "full").unwrap_err();

        assert_eq!(error.code, "neptune-write-preview-only");
    }
}
