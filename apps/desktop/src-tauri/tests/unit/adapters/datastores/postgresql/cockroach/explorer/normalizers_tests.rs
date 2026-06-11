use super::*;

#[test]
fn cockroach_record_normalizers_produce_view_friendly_fields() {
    let jobs = normalize_jobs(vec![json!({
        "job_id": "1",
        "job_type": "SCHEMA CHANGE",
        "status": "running",
        "fraction_completed": "0.5"
    })]);
    assert_eq!(jobs[0]["type"], "SCHEMA CHANGE");

    let grants = normalize_grants(vec![json!({
        "database_name": "defaultdb",
        "schema_name": "public",
        "object_name": "accounts",
        "grantee": "app",
        "privilege_type": "SELECT"
    })]);
    assert_eq!(grants[0]["principal"], "app");
    assert_eq!(grants[0]["object"], "defaultdb.public.accounts");
}
