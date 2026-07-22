use super::{is_oracle_system_owner, oracle_object_filter};

#[test]
fn oracle_structure_filter_escapes_owner_and_object_names() {
    let filter = oracle_object_filter(
        "owner",
        "table_name",
        &[
            ("APP'S".into(), "ORDERS".into()),
            ("APP'S".into(), "ACCOUNTS".into()),
        ],
    );
    assert!(filter.contains("APP''S"));
    assert!(filter.contains("ORDERS"));
    assert!(filter.contains("ACCOUNTS"));
    assert_eq!(filter.matches("owner = 'APP''S'").count(), 1);
    assert!(filter.contains("table_name in"));
}

#[test]
fn oracle_structure_marks_known_dictionary_owners_as_system() {
    assert!(is_oracle_system_owner("SYS"));
    assert!(!is_oracle_system_owner("DATAPADPLUSPLUS"));
}
