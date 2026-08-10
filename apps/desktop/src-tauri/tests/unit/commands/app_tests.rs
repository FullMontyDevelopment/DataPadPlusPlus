use super::*;

#[test]
fn idle_query_activity_hides_taskbar_progress() {
    let state = taskbar_query_progress_state(0);

    assert!(matches!(state.status, Some(ProgressBarStatus::None)));
    assert_eq!(state.progress, None);
}

#[test]
fn active_query_activity_uses_the_platform_progress_state() {
    let state = taskbar_query_progress_state(2);

    #[cfg(windows)]
    {
        assert!(matches!(
            state.status,
            Some(ProgressBarStatus::Indeterminate)
        ));
        assert_eq!(state.progress, None);
    }

    #[cfg(not(windows))]
    {
        assert!(matches!(state.status, Some(ProgressBarStatus::Normal)));
        assert_eq!(state.progress, Some(50));
    }
}

#[test]
fn frontend_diagnostic_fields_are_bounded_and_log_safe() {
    assert_eq!(normalized_frontend_level(Some("warning")), "WARN");
    assert_eq!(normalized_frontend_level(Some("anything")), "INFO");
    assert_eq!(
        diagnostic_token("window ready\r\n", "unknown"),
        "windowready"
    );
    assert_eq!(diagnostic_token("***", "unknown"), "unknown");
    assert_eq!(diagnostic_text("first\r\nsecond", 128), "first  second");
    assert_eq!(diagnostic_text("12345", 3), "123");
}
