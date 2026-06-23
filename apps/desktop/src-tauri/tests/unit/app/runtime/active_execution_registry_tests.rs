use super::ActiveExecutionRegistry;
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
