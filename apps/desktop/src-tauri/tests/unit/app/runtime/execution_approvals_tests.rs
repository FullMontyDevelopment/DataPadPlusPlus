use super::*;

#[test]
fn approvals_are_bound_and_single_use() {
    let id = issue("workspace/tab/script/scope".into()).unwrap();
    assert!(consume(&id, "workspace/tab/script/scope").is_ok());
    assert!(consume(&id, "workspace/tab/script/scope").is_err());
    let id = issue("before".into()).unwrap();
    assert!(consume(&id, "after").is_err());
}

#[test]
fn expired_approval_cannot_authorize_a_write() {
    let id = issue("expiry-test".into()).unwrap();
    APPROVALS.lock().unwrap().get_mut(&id).unwrap().1 = Instant::now() - Duration::from_secs(601);
    assert!(consume(&id, "expiry-test").is_err());
}
