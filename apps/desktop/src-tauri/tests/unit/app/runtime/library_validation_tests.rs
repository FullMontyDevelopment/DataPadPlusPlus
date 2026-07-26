use super::*;

#[test]
fn library_request_helpers_normalize_empty_ids_tags_and_supported_kinds() {
    assert_eq!(
        normalize_optional_library_id(Some(" ".into()), "Environment id").unwrap(),
        None
    );
    assert_eq!(
        normalize_optional_library_id(Some(" env-qa ".into()), "Environment id")
            .unwrap()
            .as_deref(),
        Some("env-qa")
    );
    assert_eq!(
        normalize_library_tags(vec![" sql ".into(), "".into()]).unwrap(),
        vec!["sql".to_string()]
    );
    assert_eq!(
        normalize_library_kind(Some("script".into())).unwrap(),
        "script"
    );
    assert!(normalize_library_kind(Some("folder".into())).is_err());
}

#[test]
fn every_saved_library_item_can_be_duplicated_but_connections_and_folders_cannot() {
    for kind in [
        "query",
        "script",
        "test-suite",
        "template",
        "snippet",
        "snapshot",
        "investigation-pack",
        "bookmark",
        "note",
    ] {
        assert!(is_library_item_kind(kind), "{kind} should be duplicable");
    }

    assert!(!is_library_item_kind("connection"));
    assert!(!is_library_item_kind("folder"));
}
