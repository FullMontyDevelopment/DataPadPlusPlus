use super::*;
use serde_json::json;

#[test]
fn query_execution_checks_tab_identity_and_library_environment_without_retargeting() {
    let mut snapshot = super::super::blank_workspace_snapshot();
    snapshot.library_nodes = vec![
        test_node("uat", None, Some("env-uat")),
        connection_node("connection-mongo", Some("uat")),
    ];
    let connection_id = snapshot.library_nodes[1].connection_id.clone().unwrap();
    let mut tab = QueryTabState {
        connection_id: connection_id.clone(),
        environment_id: "env-prod".into(),
        ..Default::default()
    };
    assert_eq!(
        validate_tab_environment_context(&snapshot, &tab, &connection_id, "env-prod")
            .unwrap_err()
            .code,
        "query-environment-mismatch"
    );
    assert_eq!(tab.environment_id, "env-prod");
    tab.environment_id = "env-uat".into();
    assert!(validate_tab_environment_context(&snapshot, &tab, &connection_id, "env-uat").is_ok());
    assert_eq!(
        validate_tab_environment_context(&snapshot, &tab, &connection_id, "env-prod")
            .unwrap_err()
            .code,
        "query-context-changed"
    );
    assert!(
        validate_tab_environment_context(&snapshot, &tab, "wrong-connection", "env-uat").is_err()
    );
    snapshot
        .library_nodes
        .push(test_node("saved", None, Some("env-prod")));
    tab.saved_query_id = Some("saved".into());
    tab.environment_id = "env-prod".into();
    assert!(validate_tab_environment_context(&snapshot, &tab, &connection_id, "env-prod").is_ok());
    tab.saved_query_id = None;
    let mut other = connection_node("other-row", None);
    other.connection_id = Some(connection_id.clone());
    other.environment_id = Some("env-prod".into());
    snapshot.library_nodes.push(other);
    assert!(validate_tab_environment_context(&snapshot, &tab, &connection_id, "env-prod").is_ok());
}

#[test]
fn effective_library_environment_uses_closest_parent_assignment() {
    let nodes = vec![
        test_node("top", None, Some("env-a")),
        test_node("child", Some("top"), Some("env-b")),
        test_node("query", Some("child"), None),
        test_node("direct-query", Some("child"), Some("env-c")),
    ];

    assert_eq!(
        effective_library_environment_id_for_nodes(&nodes, "query").as_deref(),
        Some("env-b")
    );
    assert_eq!(
        effective_library_environment_id_for_nodes(&nodes, "direct-query").as_deref(),
        Some("env-c")
    );
}

#[test]
fn effective_library_environment_stops_on_parent_cycles() {
    let nodes = vec![
        test_node("first", Some("second"), None),
        test_node("second", Some("first"), None),
    ];

    assert_eq!(
        effective_library_environment_id_for_nodes(&nodes, "first"),
        None
    );
}

#[test]
fn library_save_preserves_an_existing_nested_parent() {
    let nodes = vec![
        test_node("prod", None, None),
        test_node("mongo", Some("prod"), None),
        test_node("queries", Some("mongo"), None),
        test_node("query", Some("queries"), None),
    ];

    assert_eq!(
        library_folder_for_save(&nodes, "query", None, Some("mongo".into())).as_deref(),
        Some("queries")
    );
}

#[test]
fn library_save_preserves_an_existing_root_parent() {
    let nodes = vec![
        test_node("query", None, None),
        connection_node("connection-mongo", Some("prod")),
    ];

    assert_eq!(
        library_folder_for_save(&nodes, "query", None, Some("prod".into())),
        None
    );
}

#[test]
fn library_save_honors_an_explicit_folder() {
    let nodes = vec![test_node("query", Some("queries"), None)];

    assert_eq!(
        library_folder_for_save(
            &nodes,
            "query",
            Some("archive".into()),
            Some("mongo".into())
        )
        .as_deref(),
        Some("archive")
    );
}

#[test]
fn library_save_uses_the_connection_default_for_new_or_stale_items() {
    let nodes = vec![connection_node("connection-mongo", Some("mongo"))];

    assert_eq!(
        library_folder_for_save(&nodes, "missing-query", None, Some("mongo".into())).as_deref(),
        Some("mongo")
    );
}

#[test]
fn library_copy_names_are_scoped_to_the_immediate_parent() {
    let mut source = test_node("query", Some("queries"), None);
    source.name = "Orders".into();
    let mut first_copy = test_node("query-copy", Some("queries"), None);
    first_copy.name = "Copy of Orders".into();
    let mut second_copy = test_node("query-copy-2", Some("queries"), None);
    second_copy.name = "Copy of Orders (2)".into();
    let mut other_folder_copy = test_node("query-copy-other", Some("archive"), None);
    other_folder_copy.name = "Copy of Orders (3)".into();

    assert_eq!(
        next_library_copy_name(
            &[source.clone(), first_copy, second_copy, other_folder_copy],
            &source,
        ),
        "Copy of Orders (3)"
    );
}

#[test]
fn duplicate_connection_preserves_settings_and_vault_refs_but_not_queries_or_selection() {
    let mut snapshot = super::super::blank_workspace_snapshot();
    let secret = json!({
        "id": "fixture-vault-reference", "provider": "desktop-secret-store",
        "service": "DataPadPlusPlus", "account": "fixture-account", "label": "Credential"
    });
    let mut profile =
        serde_json::to_value(crate::domain::models::ConnectionProfile::default()).unwrap();
    profile["id"] = json!("source");
    profile["name"] = json!("Local database");
    profile["engine"] = json!("mongodb");
    profile["family"] = json!("document");
    profile["environmentIds"] = json!(["env-dev", "env-qa"]);
    profile["tags"] = json!(["team"]);
    profile["readOnly"] = json!(true);
    profile["favorite"] = json!(true);
    profile["connectionMode"] = json!("connection-string");
    profile["auth"]["secretRef"] = secret.clone();
    profile["auth"]["connectionStringSecretRef"] = secret;
    profile["mongodbOptions"] = json!({ "replicaSet": "fixture", "tls": true, "maxPoolSize": 20 });
    snapshot
        .connections
        .push(serde_json::from_value(profile).unwrap());
    ensure_connection_library_nodes(&mut snapshot);
    let node_id = connection_library_node_id("source");
    let node = snapshot
        .library_nodes
        .iter_mut()
        .find(|node| node.id == node_id)
        .unwrap();
    node.parent_id = Some("folder-team".into());
    node.environment_id = Some("env-qa".into());
    snapshot.library_nodes.push(LibraryNode {
        id: "saved-query".into(),
        kind: "query".into(),
        parent_id: Some(node_id.clone()),
        connection_id: Some("source".into()),
        query_text: Some("fixture query".into()),
        ..Default::default()
    });
    let before = snapshot.clone();

    duplicate_library_node_in_snapshot(&mut snapshot, &node_id).unwrap();

    let copy = snapshot.connections.last().unwrap();
    assert_ne!(copy.id, "source");
    let mut expected = serde_json::to_value(&before.connections[0]).unwrap();
    expected["id"] = json!(copy.id);
    expected["name"] = json!("Copy of Local database");
    expected["createdAt"] = json!(copy.created_at);
    expected["updatedAt"] = json!(copy.updated_at);
    assert_eq!(serde_json::to_value(copy).unwrap(), expected);
    assert_eq!(
        serde_json::to_value(&snapshot.connections[0]).unwrap(),
        serde_json::to_value(&before.connections[0]).unwrap()
    );
    let node = snapshot.library_nodes.last().unwrap();
    assert_eq!(node.id, connection_library_node_id(&copy.id));
    assert_eq!(node.connection_id.as_deref(), Some(copy.id.as_str()));
    assert_eq!(node.parent_id.as_deref(), Some("folder-team"));
    assert_eq!(node.environment_id.as_deref(), Some("env-qa"));
    assert_eq!(snapshot.library_nodes.len(), before.library_nodes.len() + 1);
    assert_eq!(
        serde_json::to_value(&snapshot.tabs).unwrap(),
        serde_json::to_value(&before.tabs).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&snapshot.ui).unwrap(),
        serde_json::to_value(&before.ui).unwrap()
    );

    duplicate_library_node_in_snapshot(&mut snapshot, &node_id).unwrap();
    assert_eq!(
        snapshot.connections.last().unwrap().name,
        "Copy of Local database (2)"
    );
    assert_ne!(snapshot.connections[1].id, snapshot.connections[2].id);
}

#[test]
fn duplicate_connection_missing_profile_leaves_snapshot_unchanged() {
    let mut snapshot = super::super::blank_workspace_snapshot();
    snapshot.library_nodes.push(LibraryNode {
        id: "dangling".into(),
        kind: "connection".into(),
        connection_id: Some("missing".into()),
        ..Default::default()
    });
    let before = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(
        duplicate_library_node_in_snapshot(&mut snapshot, "dangling")
            .unwrap_err()
            .code,
        "connection-missing"
    );
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), before);
    assert!(duplicate_library_node_in_snapshot(&mut snapshot, "unknown").is_err());
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), before);
}

#[test]
fn duplicate_folder_remains_unsupported() {
    let mut snapshot = super::super::blank_workspace_snapshot();
    snapshot.library_nodes.push(test_node("folder", None, None));
    let before = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(
        duplicate_library_node_in_snapshot(&mut snapshot, "folder")
            .unwrap_err()
            .code,
        "library-duplicate-unsupported"
    );
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), before);
}

#[test]
fn duplicated_test_suites_receive_an_independent_identity_and_copy_name() {
    let mut node = test_node("suite-copy", Some("tests"), None);
    node.kind = "test-suite".into();
    node.name = "Copy of Catalog checks".into();
    node.test_suite = Some(json!({
        "id": "suite-source",
        "name": "Catalog checks",
        "cases": [],
    }));

    refresh_duplicated_test_suite_identity(&mut node);

    assert_eq!(
        node.test_suite
            .as_ref()
            .and_then(|suite| suite.get("name"))
            .and_then(Value::as_str),
        Some("Copy of Catalog checks")
    );
    assert_ne!(
        node.test_suite
            .as_ref()
            .and_then(|suite| suite.get("id"))
            .and_then(Value::as_str),
        Some("suite-source")
    );
}

#[test]
fn local_file_content_uses_script_text_for_script_tabs() {
    let tab = QueryTabState {
        query_text: "{ \"collection\": \"products\" }".into(),
        query_view_mode: Some("script".into()),
        script_text: Some("db.products.find({ sku: 'luna-lamp' })".into()),
        ..QueryTabState::default()
    };

    assert_eq!(
        local_file_content_for_tab(&tab),
        "db.products.find({ sku: 'luna-lamp' })"
    );
}

#[test]
fn local_file_content_serializes_test_suite_tabs() {
    let tab = QueryTabState {
        tab_kind: Some("test-suite".into()),
        query_text: "stale raw text".into(),
        test_suite: Some(json!({ "name": "Smoke", "cases": [] })),
        ..QueryTabState::default()
    };

    let content = local_file_content_for_tab(&tab);
    assert!(content.contains("\"name\": \"Smoke\""));
    assert!(!content.contains("stale raw text"));
}

#[test]
fn local_save_path_requires_absolute_file_path() {
    assert!(validate_local_save_path(&PathBuf::from("relative.sql")).is_err());
    assert!(validate_local_save_path(&std::env::temp_dir().join("query.sql")).is_ok());
}

#[test]
fn local_save_path_rejects_folders_and_unsupported_file_names() {
    assert!(validate_local_save_path(&std::env::temp_dir()).is_err());
    assert!(validate_local_save_path(&std::env::temp_dir().join("bad:name.sql")).is_err());
}

fn test_node(id: &str, parent_id: Option<&str>, environment_id: Option<&str>) -> LibraryNode {
    LibraryNode {
        id: id.into(),
        kind: if id.contains("query") {
            "query".into()
        } else {
            "folder".into()
        },
        parent_id: parent_id.map(str::to_string),
        name: id.into(),
        summary: None,
        tags: Vec::new(),
        favorite: None,
        created_at: "2026-05-15T00:00:00.000Z".into(),
        updated_at: "2026-05-15T00:00:00.000Z".into(),
        last_opened_at: None,
        connection_id: None,
        environment_id: environment_id.map(str::to_string),
        language: None,
        query_text: None,
        query_view_mode: None,
        document_efficiency_mode: None,
        scoped_target: None,
        sql_scope: None,
        builder_state: None,
        script_text: None,
        test_suite: None,
        snapshot_result_id: None,
    }
}

fn connection_node(connection_id: &str, parent_id: Option<&str>) -> LibraryNode {
    LibraryNode {
        id: format!("library-{connection_id}"),
        kind: "connection".into(),
        parent_id: parent_id.map(str::to_string),
        name: connection_id.into(),
        connection_id: Some(connection_id.into()),
        ..test_node("folder", None, None)
    }
}
