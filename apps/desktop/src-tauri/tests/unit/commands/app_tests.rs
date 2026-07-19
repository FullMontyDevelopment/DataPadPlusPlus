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
