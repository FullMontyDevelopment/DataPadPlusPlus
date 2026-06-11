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
