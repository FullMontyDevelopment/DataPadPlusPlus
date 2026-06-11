use super::*;

#[test]
fn cockroach_range_surface_does_not_reference_fake_sample_table() {
    let surface = cockroach_surface_for_node("cockroach-ranges").expect("range surface");

    assert!(!surface.query_template.contains("sample_table"));
    assert!(surface.query_template.contains("crdb_internal"));
    assert!(surface
        .payload
        .get("ranges")
        .and_then(Value::as_array)
        .is_some());
    assert!(surface.payload.get("category").is_none());
}

#[test]
fn cockroach_security_surface_is_view_friendly() {
    let surface = cockroach_surface_for_node("cockroach-roles").expect("security surface");

    assert_eq!(surface.kind, "security");
    assert!(surface
        .payload
        .get("roles")
        .and_then(Value::as_array)
        .is_some());
    assert!(surface
        .payload
        .get("grants")
        .and_then(Value::as_array)
        .is_some());
}

#[test]
fn cockroach_manifest_scope_nodes_are_recognized() {
    assert_eq!(
        cockroach_surface_for_node("cockroach:statements")
            .expect("statements")
            .kind,
        "statements"
    );
    assert_eq!(
        cockroach_surface_for_node("cockroach:zone-configurations")
            .expect("zones")
            .kind,
        "zone-configurations"
    );
    assert_eq!(
        cockroach_surface_for_node("cockroach:certificates")
            .expect("certificates")
            .kind,
        "certificates"
    );
}
