use super::{is_activity, is_sidebar_pane};

#[test]
fn legacy_tests_activity_and_sidebar_pane_are_valid() {
    assert!(is_activity("tests"));
    assert!(is_sidebar_pane("tests"));
}
