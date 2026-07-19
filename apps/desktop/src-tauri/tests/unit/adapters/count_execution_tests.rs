use super::*;

#[test]
fn registered_count_execution_can_be_cancelled() {
    let guard = register_count_execution(Some("count-execution-test"));
    assert!(guard.check().is_ok());
    assert!(cancel_count_execution("count-execution-test"));
    assert_eq!(
        guard.check().expect_err("count should be cancelled").code,
        "execution-cancelled"
    );
}
