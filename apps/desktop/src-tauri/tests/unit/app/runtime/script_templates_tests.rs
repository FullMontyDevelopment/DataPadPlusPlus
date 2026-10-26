use super::*;

#[test]
fn preserves_javascript_and_comments() {
    let source = "const NAME = 'x'; print(`${NAME}: ${1 + 2}`); // {{MISSING}}";
    assert_eq!(
        resolve_script_template(source, &HashMap::new()).unwrap(),
        source
    );
}

#[test]
fn escapes_data_without_recursive_substitution() {
    let vars = HashMap::from([("VALUE".into(), "'\"`\\\n${x}{{OTHER}}".into())]);
    let output = resolve_script_template("print('{{VALUE}}', `{{VALUE}} ${1+2}`)", &vars).unwrap();
    assert!(output.contains("\\'"));
    assert!(output.contains("\\${x}"));
    assert!(output.contains("${1+2}"));
    assert!(output.contains("{{OTHER}}"));
}

#[test]
fn missing_variable_identifies_key_not_contents() {
    let error = resolve_script_template("print('{{MISSING}}')", &HashMap::new()).unwrap_err();
    assert_eq!(error.code, "environment-variable-unresolved");
    assert!(error.message.contains("MISSING"));
}

#[test]
fn substituted_values_roundtrip_as_data_in_every_quote_style() {
    let value = "'\"`\\\n${malicious()}{{OTHER}}";
    let source = resolve_script_template(
        r#"JSON.stringify(["{{VALUE}}", '{{VALUE}}', `{{VALUE}}`, '\{{VALUE}}'])"#,
        &HashMap::from([("VALUE".into(), value.into())]),
    )
    .unwrap();
    let runtime = rquickjs::Runtime::new().unwrap();
    let context = rquickjs::Context::full(&runtime).unwrap();
    let result = context.with(|ctx| ctx.eval::<String, _>(source.as_str()).unwrap());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&result).unwrap(),
        serde_json::json!([value, value, value, "{{VALUE}}"])
    );
}
