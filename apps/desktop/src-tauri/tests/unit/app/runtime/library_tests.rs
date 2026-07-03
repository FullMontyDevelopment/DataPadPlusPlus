use super::*;
use serde_json::json;

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
        builder_state: None,
        script_text: None,
        test_suite: None,
        snapshot_result_id: None,
    }
}
