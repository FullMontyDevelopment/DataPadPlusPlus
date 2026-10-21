use super::*;

#[test]
fn full_export_reference_is_independent_of_presentation_but_loaded_exports_remain_typed() {
    for renderer in ["document", "table", "keyvalue", "graph", "raw", "series"] {
        let mut request: ExportResultFileRequest = serde_json::from_value(json!({
            "suggestedFileName":"fixture", "extension":"json", "mimeType":"application/json",
            "resultReference":{
                "tabId":"fixture-tab", "resultId":"fixture-result", "renderer":renderer,
                "format":"json", "scope":"full-query"
            }
        }))
        .unwrap();
        validate_export_result_file_request(&request).unwrap();
        request.result_reference.as_mut().unwrap().scope = Some("loaded".into());
        assert_eq!(
            validate_export_result_file_request(&request).is_ok(),
            matches!(renderer, "table" | "document")
        );
    }
}

#[test]
fn canceled_or_failed_output_preserves_destination_and_removes_temporary_files() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("existing.json");
    std::fs::write(&destination, b"original").unwrap();
    {
        let mut output = AtomicResultOutput::new(&destination).unwrap();
        output.file().write_all(b"partial").unwrap();
        // Dropping is the cancellation/error path, including an aborted future.
    }
    assert_eq!(std::fs::read(&destination).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    let mut output = AtomicResultOutput::new(&destination).unwrap();
    output.file().write_all(b"complete").unwrap();
    output.commit().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"complete");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn failed_finalization_does_not_publish_or_leave_a_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("not-a-file");
    std::fs::create_dir(&destination).unwrap();
    let mut output = AtomicResultOutput::new(&destination).unwrap();
    output.file().write_all(b"complete").unwrap();
    assert_eq!(output.commit().unwrap_err().code, "result-export-finalize");
    assert!(destination.is_dir());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn streaming_json_exports_all_accumulated_values_including_over_500() {
    for count in [0, 501, 1500, 10_001] {
        let mut bytes = Vec::new();
        let mut writer = ExportWriter::new(&mut bytes, "json", None, None).unwrap();
        for id in 0..count {
            assert!(writer.row(json!({"_id": id, "nested": {"value": "original"}, "__datapadLazyNode": "user data"})).unwrap());
        }
        writer.finish().unwrap();
        assert_eq!(writer.count, count);
        assert!(!writer.limited);
        let values: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(values.len(), count as usize);
        if count > 0 {
            assert_eq!(values.last().unwrap()["_id"], count - 1);
            assert_eq!(values[0]["__datapadLazyNode"], "user data");
        }
    }
}

#[test]
fn explicit_export_cap_reports_limited_only_when_more_values_exist() {
    for count in [2, 3, 4] {
        let mut bytes = Vec::new();
        let mut writer = ExportWriter::new(&mut bytes, "ndjson", Some(3), None).unwrap();
        for id in 0..count {
            if !writer.row(json!({"id": id})).unwrap() {
                break;
            }
        }
        writer.finish().unwrap();
        assert_eq!(writer.count, count.min(3));
        assert_eq!(writer.limited, count > 3);
    }
}

#[test]
fn csv_quotes_values_and_rejects_new_columns_instead_of_losing_them() {
    let mut bytes = Vec::new();
    let mut writer = ExportWriter::new(&mut bytes, "csv", None, None).unwrap();
    writer
        .row(json!({"value": "Unicode λ,\n\"quoted\""}))
        .unwrap();
    assert!(writer.row(json!({"value": "a", "later": true})).is_err());
    writer.finish().unwrap();
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        "\"value\"\r\n\"Unicode λ,\n\"\"quoted\"\"\"\r\n"
    );
}

#[test]
fn table_records_preserve_datastore_column_values() {
    let payload = json!({"renderer": "table", "columns": ["id", "value"], "rows": [["1", "text"], ["2", "NULL"]]});
    assert_eq!(
        records(&payload).collect::<Vec<_>>(),
        vec![
            json!({"id": "1", "value": "text"}),
            json!({"id": "2", "value": "NULL"})
        ]
    );
}

#[test]
fn duplicate_columns_are_never_silently_overwritten() {
    assert!(validate_export_columns(
        &json!({"columns": ["id", "id"], "rows": [["first", "second"]]})
    )
    .is_err());
    assert!(validate_export_columns(&json!({"columns": ["id", "ID"]})).is_ok());
}

#[test]
fn write_failure_is_sanitized() {
    struct FullDisk;
    impl Write for FullDisk {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("private path and secret values"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let error = ExportWriter::new(FullDisk, "json", None, None)
        .err()
        .unwrap();
    assert!(!error.message.contains("private"));
    assert!(error.message.contains("disk space"));
}
