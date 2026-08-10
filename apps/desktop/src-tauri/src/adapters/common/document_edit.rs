use serde_json::{json, Value};

use crate::domain::{
    error::CommandError,
    models::{DataEditExecutionRequest, DataEditTarget},
};

pub(crate) fn document_replacement_from_request(
    request: &DataEditExecutionRequest,
    code_prefix: &str,
) -> Result<Value, CommandError> {
    let value = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
        .ok_or_else(|| {
            CommandError::new(
                format!("{code_prefix}-missing-document"),
                "Document edit requires a full replacement object.",
            )
        })?;
    if !value.is_object() || value.is_array() {
        return Err(CommandError::new(
            format!("{code_prefix}-invalid-document"),
            "Document edit requires a full replacement object.",
        ));
    }
    Ok(value.clone())
}

pub(crate) fn ensure_document_add_path_absent(
    request: &DataEditExecutionRequest,
    before: &Value,
    code_prefix: &str,
) -> Result<(), CommandError> {
    if request.edit_kind != "add-field" {
        return Ok(());
    }
    let path = request
        .target
        .path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if path.is_empty() {
        return Err(CommandError::new(
            format!("{code_prefix}-add-path-missing"),
            "Add Field requires a non-empty object-property path.",
        ));
    }
    if document_value_at_path(before, &path).is_some() {
        return Err(CommandError::new(
            format!("{code_prefix}-field-exists"),
            format!(
                "Field `{}` already exists; Add Field never overwrites values.",
                path.join(".")
            ),
        ));
    }
    Ok(())
}

pub(crate) fn ensure_protected_document_paths(
    before: &Value,
    after: &Value,
    paths: &[Vec<String>],
    code_prefix: &str,
) -> Result<(), CommandError> {
    for path in paths {
        let segments = path.iter().map(String::as_str).collect::<Vec<_>>();
        if document_value_at_path(before, &segments) != document_value_at_path(after, &segments) {
            return Err(CommandError::new(
                format!("{code_prefix}-protected-field"),
                format!(
                    "Protected document field `{}` cannot be changed.",
                    path.join(".")
                ),
            ));
        }
    }
    Ok(())
}

pub(crate) fn document_value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = match current {
            Value::Object(object) => object.get(*segment)?,
            Value::Array(items) => items.get(segment.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current)
}

pub(crate) fn document_evidence(before: Option<Value>, after: Option<Value>) -> Value {
    json!({
        "documentEvidence": {
            "beforeDocument": before,
            "afterDocument": after,
        }
    })
}

pub(crate) fn required_document_target<'a>(
    target: &'a DataEditTarget,
    code_prefix: &str,
) -> Result<(&'a str, &'a Value), CommandError> {
    let collection = target
        .collection
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                format!("{code_prefix}-collection-missing"),
                "Document edit requires a collection or container.",
            )
        })?;
    let id = target
        .document_id
        .as_ref()
        .filter(|value| !value.is_null())
        .ok_or_else(|| {
            CommandError::new(
                format!("{code_prefix}-identity-missing"),
                "Document edit requires stable identity evidence.",
            )
        })?;
    Ok((collection, id))
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/document_edit_tests.rs"]
mod tests;
