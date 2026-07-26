use super::{ActiveExecutionRegistry, ActiveTestRunRegistry};
use futures_util::future::AbortHandle;

#[test]
fn aborts_registered_execution_once() {
    let (handle, registration) = AbortHandle::new_pair();
    let mut registry = ActiveExecutionRegistry::default();

    registry.register("exec-1".into(), handle);

    assert!(registry.abort("exec-1"));
    assert!(registration.handle().is_aborted());
    assert!(!registry.abort("exec-1"));
}

#[test]
fn remove_clears_execution_without_aborting() {
    let (handle, registration) = AbortHandle::new_pair();
    let mut registry = ActiveExecutionRegistry::default();

    registry.register("exec-1".into(), handle);
    registry.remove("exec-1");

    assert!(!registry.abort("exec-1"));
    assert!(!registration.handle().is_aborted());
}

#[test]
fn test_run_registry_signals_cancellation_without_aborting_teardown() {
    let (sender, receiver) = tokio::sync::watch::channel(false);
    let mut registry = ActiveTestRunRegistry::default();

    registry.register("run-1".into(), sender).unwrap();

    assert!(registry.cancel("run-1"));
    assert!(*receiver.borrow());
    registry.remove("run-1");
    assert!(!registry.cancel("run-1"));
}

#[test]
fn test_run_registry_rejects_duplicate_active_run_ids() {
    let (first, _) = tokio::sync::watch::channel(false);
    let (second, _) = tokio::sync::watch::channel(false);
    let mut registry = ActiveTestRunRegistry::default();

    registry.register("run-1".into(), first).unwrap();

    assert!(registry.register("run-1".into(), second).is_err());
}
