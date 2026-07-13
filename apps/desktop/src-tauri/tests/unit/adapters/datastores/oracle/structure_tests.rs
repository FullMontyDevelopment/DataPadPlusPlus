use super::{is_oracle_system_owner, oracle_object_filter};

#[test]
fn oracle_structure_filter_escapes_owner_and_object_names() {
    let filter = oracle_object_filter("owner", "table_name", &[("APP'S".into(), "ORDERS".into())]);
    assert!(filter.contains("APP''S"));
    assert!(filter.contains("ORDERS"));
}

#[test]
fn oracle_structure_marks_known_dictionary_owners_as_system() {
    assert!(is_oracle_system_owner("SYS"));
    assert!(!is_oracle_system_owner("DATAPADPLUSPLUS"));
}
