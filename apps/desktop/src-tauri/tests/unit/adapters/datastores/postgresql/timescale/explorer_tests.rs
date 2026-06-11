use super::timescale_select_template;

#[test]
fn timescale_select_template_keeps_schema_context() {
    assert_eq!(
        timescale_select_template("metrics", "cpu"),
        "select * from \"metrics\".\"cpu\" limit 100;"
    );
}

#[test]
fn timescale_select_template_escapes_identifiers() {
    assert_eq!(
        timescale_select_template("metrics-prod", "cpu\"daily"),
        "select * from \"metrics-prod\".\"cpu\"\"daily\" limit 100;"
    );
}
