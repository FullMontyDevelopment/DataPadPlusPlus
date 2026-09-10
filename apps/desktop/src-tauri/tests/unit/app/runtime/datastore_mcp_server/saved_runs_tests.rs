use super::*;

#[test]
fn mcp_saved_execution_requires_separate_explicit_read_and_write_permissions() {
    let read = vec![SCOPE_QUERY_READ.into()];
    let write = vec![SCOPE_QUERY_READ.into(), SCOPE_QUERY_WRITE.into()];
    for (language, query) in [
        ("sql", "select 1"),
        ("redis", "GET isolated"),
        ("mongodb", "db.items.find({})"),
    ] {
        assert!(!authorize_saved_query(&read, query, language).unwrap());
    }
    for (language, query) in [
        ("sql", "create table isolated (id integer)"),
        ("sql", "delete from isolated"),
        ("redis", "SET isolated 1"),
        ("mongodb", "db.items.insertOne({id:1})"),
    ] {
        assert_eq!(
            authorize_saved_query(&read, query, language)
                .unwrap_err()
                .code,
            "mcp-scope-required"
        );
        assert!(authorize_saved_query(&write, query, language).unwrap());
        assert!(authorize_saved_query(&[SCOPE_QUERY_WRITE.into()], query, language).is_err());
    }
}

#[test]
fn mcp_suite_preflight_covers_all_enabled_phases_and_selected_cases() {
    let step = |id: &str, query: &str| json!({"id":id,"kind":"query","queryText":query});
    let tab = QueryTabState {
        tab_kind: Some("test-suite".into()),
        test_suite: Some(json!({
            "variables":{"value":"42"},"cases":[{"id":"one","setup":[step("setup","insert into isolated values ({{value}})")],"execute":[step("query","select 1")],"teardown":[step("cleanup","delete from isolated")]},
            {"id":"disabled","enabled":false,"setup":[],"execute":[step("skip","drop table other")],"teardown":[]}]
        })),
        ..Default::default()
    };
    let queries = queries_for_tab(&tab, Some("one")).unwrap();
    assert_eq!(
        queries,
        vec![
            "insert into isolated values (42)",
            "select 1",
            "delete from isolated"
        ]
    );
    assert!(queries_for_tab(&tab, Some("disabled")).is_err());
    assert!(queries_for_tab(&tab, Some("missing")).is_err());
}

#[test]
fn mcp_revoked_tokens_and_disabled_servers_are_rejected_from_current_snapshot() {
    let mut snapshot = crate::app::runtime::blank_workspace_snapshot();
    snapshot.preferences.datastore_mcp_server.enabled = true;
    snapshot.preferences.datastore_mcp_server.servers = vec![DatastoreMcpServerConfig {
        id: "server".into(),
        tokens: vec![DatastoreMcpServerTokenConfig {
            id: "token".into(),
            enabled: true,
            scopes: vec![SCOPE_LIBRARY_READ.into()],
            ..Default::default()
        }],
        ..Default::default()
    }];
    assert!(token_config(&snapshot, "server", "token").is_ok());
    snapshot.preferences.datastore_mcp_server.servers[0].tokens[0].enabled = false;
    assert!(token_config(&snapshot, "server", "token").is_err());
    snapshot.preferences.datastore_mcp_server.enabled = false;
    assert!(token_config(&snapshot, "server", "token").is_err());
}
