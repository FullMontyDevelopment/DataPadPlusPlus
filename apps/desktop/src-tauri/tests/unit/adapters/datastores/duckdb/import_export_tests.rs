use super::*;

#[test]
fn duckdb_workflow_table_parses_quoted_schema_table() {
    let request = OperationExecutionRequest {
        connection_id: "conn".into(),
        environment_id: "env".into(),
        operation_id: "duckdb.data.import-export".into(),
        object_name: Some("\"main\".\"orders\"".into()),
        parameters: None,
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    };

    assert_eq!(
        workflow_table(&request),
        Some(("main".into(), "orders".into()))
    );
}

#[test]
fn duckdb_reader_uses_format_specific_table_functions() {
    let path = PathBuf::from("C:\\fixtures\\orders.csv");
    assert!(duckdb_reader(&path, "csv").contains("read_csv_auto"));
    assert!(duckdb_reader(&path, "json").contains("read_json_auto"));
    assert!(duckdb_reader(&path, "parquet").contains("read_parquet"));
}
