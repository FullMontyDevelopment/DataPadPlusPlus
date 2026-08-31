use super::*;

#[test]
fn transfer_extensions_are_normalized_and_restricted() {
    let values = vec![
        ".JSON".to_string(),
        "ndjson".to_string(),
        "../secret".to_string(),
        "".to_string(),
    ];

    assert_eq!(safe_extensions(&values), vec!["json", "ndjson"]);
}

#[test]
fn suggested_transfer_names_cannot_escape_the_picker() {
    assert_eq!(
        safe_suggested_file_name("../Customer export 2026.json"),
        "..-Customer-export-2026.json",
    );
}

#[test]
fn selection_request_rejects_non_local_picker_destinations() {
    let request = DatastoreTransferFileSelectionRequest {
        operation_id: "sqlite.table.export".into(),
        connection_id: "connection-1".into(),
        environment_id: "environment-1".into(),
        action: "export".into(),
        destination_kind: "cloud-uri".into(),
        format_id: "json".into(),
        extensions: vec!["json".into()],
        suggested_file_name: None,
    };

    let error = validate_selection_request(&request).expect_err("cloud targets use native forms");
    assert_eq!(error.code, "datastore-transfer-destination-invalid");
}

#[test]
fn transfer_paths_are_removed_from_nested_metadata() {
    let path = r"C:\private\exports\customers.json";
    let mut value = serde_json::json!({
        "path": path,
        "nested": [format!("Saved {path}")],
    });

    redact_json_path(&mut value, path, "<selected-file>/customers.json");

    let serialized = serde_json::to_string(&value).expect("metadata serializes");
    assert!(!serialized.contains("private"));
    assert!(serialized.contains("selected-file"));
}

#[test]
fn incomplete_output_keeps_the_native_extension() {
    let final_path = std::path::Path::new("exports").join("customers.ndjson");
    let incomplete = incomplete_output_path(&final_path);
    let name = incomplete
        .file_name()
        .and_then(|value| value.to_str())
        .expect("incomplete file name");

    assert!(name.starts_with(".customers.datapad-incomplete-"));
    assert!(name.ends_with(".ndjson"));
    assert_ne!(incomplete, final_path);
}

#[test]
fn completed_output_is_atomically_promoted_from_its_temporary_name() {
    let root = std::env::temp_dir().join(generate_id("datapad-transfer-test"));
    std::fs::create_dir_all(&root).expect("temporary test folder");
    let final_path = root.join("customers.json");
    let execution_path = incomplete_output_path(&final_path);
    std::fs::write(&execution_path, br#"[{"id":1}]"#).expect("temporary transfer output");
    let selection_id = generate_id("selection-test");
    pending_datastore_transfer_selections()
        .lock()
        .expect("selection store")
        .insert(
            selection_id.clone(),
            PendingDatastoreTransferSelection {
                path: final_path.clone(),
                destination_kind: "local-file".into(),
                operation_id: "sqlite.table.export".into(),
                connection_id: "connection-1".into(),
                environment_id: "environment-1".into(),
                action: "export".into(),
                format_id: "json".into(),
                created_at: Instant::now(),
                in_use: true,
            },
        );
    let resolved = ResolvedDatastoreTransferSelection {
        selection_id: selection_id.clone(),
        final_path: final_path.clone(),
        execution_path: execution_path.clone(),
        file_name: "customers.json".into(),
        temporary_output: true,
    };

    complete_datastore_transfer_selection(&resolved, true).expect("finalize transfer");

    assert!(final_path.is_file());
    assert!(!execution_path.exists());
    assert!(!pending_datastore_transfer_selections()
        .lock()
        .expect("selection store")
        .contains_key(&selection_id));
    std::fs::remove_file(&final_path).expect("remove test output");
    std::fs::remove_dir(&root).expect("remove test folder");
}
