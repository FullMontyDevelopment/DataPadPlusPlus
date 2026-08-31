use super::*;

#[test]
fn arango_transfer_formats_map_to_native_import_shapes() {
    assert_eq!(
        ArangoTransferFormat::parse("json").unwrap().import_type(),
        "array"
    );
    assert_eq!(
        ArangoTransferFormat::parse("jsonl").unwrap().import_type(),
        "documents"
    );
    assert!(ArangoTransferFormat::parse("csv").is_err());
}

#[test]
fn arango_cursor_pages_require_valid_json_and_report_api_errors() {
    let page =
        parse_cursor_page(r#"{"result":[{"_key":"one"}],"hasMore":true,"id":"123","error":false}"#)
            .unwrap();
    assert_eq!(page.result.len(), 1);
    assert!(page.has_more);
    assert_eq!(page.id.as_deref(), Some("123"));
    assert!(parse_cursor_page(r#"{"error":true}"#).is_err());
    assert!(parse_cursor_page("not-json").is_err());
}

#[test]
fn arango_cursor_identifiers_are_never_interpolated_unsafely() {
    assert_eq!(cursor_path("12345").unwrap(), "/_api/cursor/12345");
    assert!(cursor_path("../other").is_err());
    assert!(cursor_path("bad?cursor").is_err());
}
