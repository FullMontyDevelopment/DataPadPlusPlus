use crate::domain::error::CommandError;

pub(super) const MAX_ID_LENGTH: usize = 160;
pub(super) const MAX_SCOPE_LENGTH: usize = 512;
pub(super) const MAX_OBJECT_NAME_LENGTH: usize = 512;
pub(super) const MAX_JSON_BYTES: usize = 64 * 1024;
pub(super) const MAX_DATA_EDIT_CHANGES: usize = 100;
pub(super) const MAX_PATH_SEGMENTS: usize = 64;
pub(super) const MAX_PATH_SEGMENT_LENGTH: usize = 256;
pub(super) const MAX_REDIS_DATABASE: u32 = 1024;
pub(super) const MAX_ROW_LIMIT: u32 = 10_000;
pub(super) const MAX_EXPLORER_LIMIT: u32 = 500;
pub(super) const MAX_STRUCTURE_LIMIT: u32 = 1_000;
pub(super) const MAX_REDIS_COUNT: u32 = 1_000;
pub(super) const MAX_REDIS_PAGE_SIZE: u32 = 1_000;
pub(super) const MAX_REDIS_SAMPLE_SIZE: u32 = 5_000;
pub(super) const MAX_QUERY_TEXT_BYTES: usize = 1024 * 1024;
pub(super) const MAX_RESULT_PAGE_SIZE: u32 = 1_000;
pub(super) const MAX_RESULT_PAGE_INDEX: u32 = 100_000;

pub(super) const DATA_EDIT_KINDS: &[&str] = &[
    "insert-row",
    "update-row",
    "delete-row",
    "set-field",
    "unset-field",
    "rename-field",
    "change-field-type",
    "insert-document",
    "set-key-value",
    "set-ttl",
    "delete-key",
    "rename-key",
    "persist-ttl",
    "hash-set-field",
    "hash-delete-field",
    "list-push",
    "list-set-index",
    "list-remove-value",
    "set-add-member",
    "set-remove-member",
    "zset-add-member",
    "zset-remove-member",
    "stream-add-entry",
    "stream-delete-entry",
    "json-set-path",
    "json-delete-path",
    "timeseries-add-sample",
    "timeseries-delete-sample",
    "vector-add-member",
    "vector-remove-member",
    "vector-set-attributes",
    "put-item",
    "update-item",
    "delete-item",
    "index-document",
    "update-document",
    "delete-document",
];

pub(super) const RESULT_RENDERERS: &[&str] = &[
    "table",
    "json",
    "document",
    "keyvalue",
    "raw",
    "resp",
    "schema",
    "graph",
    "chart",
    "diff",
    "plan",
    "metrics",
    "series",
    "searchHits",
    "profile",
    "costEstimate",
];

pub(super) fn validate_operation_id(value: &str) -> Result<(), CommandError> {
    validate_required_text(value, "Operation id", MAX_ID_LENGTH)?;
    if !value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
    {
        return Err(invalid_request(
            "Operation id contains unsupported characters.",
        ));
    }
    if !value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
    }) {
        return Err(invalid_request(
            "Operation id contains unsupported characters.",
        ));
    }
    Ok(())
}

pub(super) fn validate_required_id(value: &str, label: &str) -> Result<(), CommandError> {
    validate_required_text(value, label, MAX_ID_LENGTH)?;
    if !value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
    {
        return Err(invalid_request(format!(
            "{label} contains unsupported characters."
        )));
    }
    if !value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
    }) {
        return Err(invalid_request(format!(
            "{label} contains unsupported characters."
        )));
    }
    Ok(())
}

pub(super) fn validate_optional_id(value: Option<&str>, label: &str) -> Result<(), CommandError> {
    let Some(value) = value else {
        return Ok(());
    };
    validate_required_id(value, label)
}

pub(super) fn validate_required_text(
    value: &str,
    label: &str,
    max: usize,
) -> Result<(), CommandError> {
    if value.trim().is_empty() {
        return Err(invalid_request(format!("{label} is required.")));
    }
    validate_optional_text(Some(value), label, max)
}

pub(super) fn validate_optional_text(
    value: Option<&str>,
    label: &str,
    max: usize,
) -> Result<(), CommandError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.len() > max {
        return Err(invalid_request(format!(
            "{label} must be {max} characters or fewer."
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(invalid_request(format!(
            "{label} cannot contain control characters."
        )));
    }
    Ok(())
}

pub(super) fn validate_path(path: &[String], label: &str) -> Result<(), CommandError> {
    if path.len() > MAX_PATH_SEGMENTS {
        return Err(invalid_request(format!(
            "{label} can contain at most {MAX_PATH_SEGMENTS} segments."
        )));
    }
    for segment in path {
        validate_required_text(
            segment,
            &format!("{label} segment"),
            MAX_PATH_SEGMENT_LENGTH,
        )?;
    }
    Ok(())
}

pub(super) fn clamp_optional_u32(value: &mut Option<u32>, min: u32, max: u32) {
    if let Some(current) = value {
        *current = (*current).clamp(min, max);
    }
}

pub(super) fn assert_json_size<T: serde::Serialize>(
    value: &T,
    label: &str,
) -> Result<(), CommandError> {
    let size = serde_json::to_vec(value)?.len();
    if size > MAX_JSON_BYTES {
        return Err(invalid_request(format!(
            "{label} is too large for a desktop command."
        )));
    }
    Ok(())
}

pub(super) fn validate_query_text(value: &str, label: &str) -> Result<(), CommandError> {
    if value.len() > MAX_QUERY_TEXT_BYTES {
        return Err(invalid_request(format!(
            "{label} is too large for a desktop command."
        )));
    }
    if value.contains('\0') {
        return Err(invalid_request(format!(
            "{label} cannot contain null bytes."
        )));
    }
    Ok(())
}

pub(super) fn invalid_request(message: impl Into<String>) -> CommandError {
    CommandError::new("invalid-request", message)
}
