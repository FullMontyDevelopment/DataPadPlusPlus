use crate::domain::{error::CommandError, models::WorkspaceSnapshot};

const MAX_LIBRARY_NAME_LENGTH: usize = 512;
const MAX_LIBRARY_TAGS: usize = 32;
const MAX_LIBRARY_TAG_LENGTH: usize = 80;
const MAX_LIBRARY_ID_LENGTH: usize = 160;
const LIBRARY_ITEM_KINDS: &[&str] = &[
    "query",
    "script",
    "test-suite",
    "template",
    "snippet",
    "snapshot",
    "investigation-pack",
    "bookmark",
    "note",
];

pub(super) fn environment_or_error(
    snapshot: &WorkspaceSnapshot,
    environment_id: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(environment_id) = environment_id {
        if snapshot
            .environments
            .iter()
            .all(|environment| environment.id != environment_id)
        {
            return Err(CommandError::new(
                "library-environment-missing",
                "Environment was not found.",
            ));
        }
    }

    Ok(())
}

pub(super) fn library_name_or_error<'a>(
    value: &'a str,
    label: &str,
) -> Result<&'a str, CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CommandError::new(
            "library-name-required",
            format!("Enter a {label} before continuing."),
        ));
    }
    validate_library_text(value, label, MAX_LIBRARY_NAME_LENGTH)?;
    Ok(value)
}

pub(super) fn normalize_optional_library_id(
    value: Option<String>,
    label: &str,
) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    validate_library_id(value, label)?;
    Ok(Some(value.into()))
}

pub(super) fn validate_library_id(value: &str, label: &str) -> Result<(), CommandError> {
    validate_library_text(value, label, MAX_LIBRARY_ID_LENGTH)?;
    if !value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        return Err(CommandError::new(
            "library-id-invalid",
            format!("{label} contains unsupported characters."),
        ));
    }
    Ok(())
}

pub(super) fn normalize_library_kind(kind: Option<String>) -> Result<String, CommandError> {
    let kind = kind.unwrap_or_else(|| "query".into());
    let kind = kind.trim();
    if !LIBRARY_ITEM_KINDS.contains(&kind) {
        return Err(CommandError::new(
            "library-kind-invalid",
            format!("Unsupported Library item kind: {kind}."),
        ));
    }
    Ok(kind.into())
}

pub(super) fn normalize_library_tags(tags: Vec<String>) -> Result<Vec<String>, CommandError> {
    if tags.len() > MAX_LIBRARY_TAGS {
        return Err(CommandError::new(
            "library-tags-too-many",
            format!("Library items may include at most {MAX_LIBRARY_TAGS} tags."),
        ));
    }

    tags.into_iter()
        .map(|tag| {
            let tag = tag.trim().to_string();
            validate_library_text(&tag, "Library tag", MAX_LIBRARY_TAG_LENGTH)?;
            Ok(tag)
        })
        .filter(|result: &Result<String, CommandError>| {
            result.as_ref().map(|tag| !tag.is_empty()).unwrap_or(true)
        })
        .collect()
}

fn validate_library_text(value: &str, label: &str, max: usize) -> Result<(), CommandError> {
    if value.len() > max {
        return Err(CommandError::new(
            "library-text-too-long",
            format!("{label} must be {max} characters or fewer."),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "library-text-invalid",
            format!("{label} cannot contain control characters."),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/library_validation_tests.rs"]
mod tests;
