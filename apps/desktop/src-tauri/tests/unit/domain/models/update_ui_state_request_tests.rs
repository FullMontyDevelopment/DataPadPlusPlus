use super::UpdateUiStateRequest;

#[test]
fn accepts_fractional_layout_numbers_from_browser_measurements() {
    let request: UpdateUiStateRequest = serde_json::from_value(serde_json::json!({
        "bottomPanelHeight": 806.4000244140625,
        "sidebarWidth": 279.5,
        "resultsSideWidth": 420,
        "rightDrawerWidth": 360.49
    }))
    .expect("fractional UI state request should deserialize");

    assert_eq!(request.bottom_panel_height, Some(806));
    assert_eq!(request.sidebar_width, Some(280));
    assert_eq!(request.results_side_width, Some(420));
    assert_eq!(request.right_drawer_width, Some(360));
}

#[test]
fn rejects_invalid_layout_numbers() {
    let result = serde_json::from_value::<UpdateUiStateRequest>(serde_json::json!({
        "sidebarWidth": -1
    }));
    let error = match result {
        Ok(_) => panic!("negative UI sizes should be rejected"),
        Err(error) => error,
    };

    assert!(error.to_string().contains("finite non-negative number"));
}
#[test]
fn query_result_preferences_validate_persisted_and_imported_limits() {
    use crate::domain::models::QueryResultPreferences;
    for value in [
        serde_json::json!({"fetchBatchSize": 0}),
        serde_json::json!({"fetchBatchSize": 5001}),
        serde_json::json!({"fetchBatchSize": 1.5}),
        serde_json::json!({"maximumLoadedRows": 0}),
        serde_json::json!({"maximumExportedRows": 0}),
        serde_json::json!({"maximumExportedRows": -1}),
    ] {
        assert!(serde_json::from_value::<QueryResultPreferences>(value).is_err());
    }
    let defaults: QueryResultPreferences = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(defaults.fetch_batch_size, 500);
    assert_eq!(defaults.maximum_exported_rows, None);
    let custom: QueryResultPreferences = serde_json::from_value(
        serde_json::json!({"fetchBatchSize": 5000, "maximumLoadedRows": 1500, "maximumExportedRows": null}),
    ).unwrap();
    assert_eq!(custom.fetch_batch_size, 5000);
    assert_eq!(custom.maximum_loaded_rows, Some(1500));
}
