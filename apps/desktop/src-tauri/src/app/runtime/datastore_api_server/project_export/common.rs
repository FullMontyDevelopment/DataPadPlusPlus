use super::*;

pub(crate) fn project_file(root: &str, path: &str, contents: String) -> ProjectFile {
    ProjectFile {
        path: format!("{root}/{path}"),
        contents,
    }
}

pub(crate) fn rust_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

pub(crate) fn csharp_string_literal(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\r', "\\r")
            .replace('\n', "\\n")
    )
}

pub(crate) fn quote_ansi_identifier(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed
            .chars()
            .any(|character| character == '\0' || character.is_control())
    {
        return Err(CommandError::new(
            "api-server-export-identifier-invalid",
            "A datastore resource contains an invalid schema, table, or column identifier.",
        ));
    }
    Ok(format!("\"{}\"", trimmed.replace('"', "\"\"")))
}

pub(crate) fn postgres_parameter(index: usize) -> String {
    format!("${index}")
}

pub(crate) fn sqlite_parameter(index: usize) -> String {
    format!("?{index}")
}

pub(crate) fn dotnet_parameter(index: usize) -> String {
    format!("@p{}", index.saturating_sub(1))
}

pub(crate) fn unsupported_client_error(framework: &str, engine: &str) -> CommandError {
    let framework = match framework {
        "dotnet" => ".NET",
        "rust" => "Rust",
        other => other,
    };
    CommandError::new(
        "api-server-export-client-unsupported",
        format!(
            "{framework} project export supports PostgreSQL, SQLite, MongoDB, and DynamoDB only; `{engine}` is not supported."
        ),
    )
}

pub(crate) fn unsupported_framework_error() -> CommandError {
    CommandError::new(
        "api-server-export-framework-unsupported",
        "Choose Rust or .NET for the exported API server project.",
    )
}

pub(crate) fn unique_identifier(
    seen: &mut HashMap<String, usize>,
    value: String,
    fallback: &str,
) -> String {
    let base = if value.is_empty() {
        fallback.into()
    } else {
        value
    };
    let count = seen.entry(base.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{base}_{count}")
    }
}

pub(crate) fn safe_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if stem.is_empty() {
        "datapad-api".into()
    } else {
        stem
    }
}

pub(crate) fn snake_case(value: &str) -> String {
    let mut output = String::new();
    let mut previous_separator = true;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if character.is_ascii_uppercase() && !previous_separator && !output.ends_with('_') {
                output.push('_');
            }
            output.push(character.to_ascii_lowercase());
            previous_separator = false;
        } else if !output.ends_with('_') && !output.is_empty() {
            output.push('_');
            previous_separator = true;
        }
    }
    output.trim_matches('_').to_string()
}

pub(crate) fn pascal_case(value: &str) -> String {
    let mut output = String::new();
    for part in value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
    {
        let mut characters = part.chars();
        if let Some(first) = characters.next() {
            output.push(first.to_ascii_uppercase());
            output.extend(characters);
        }
    }
    if output
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        output.insert_str(0, "Item");
    }
    output
}

pub(crate) fn api_parameter_names(query_text: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut offset = 0usize;
    while let Some(start) = query_text[offset..].find("{{api.") {
        let token_start = offset + start + "{{api.".len();
        let Some(end) = query_text[token_start..].find("}}") else {
            break;
        };
        let raw_name = &query_text[token_start..token_start + end];
        if let Some(name) = normalize_api_parameter_name(raw_name) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        offset = token_start + end + "}}".len();
    }
    names
}

pub(crate) fn normalize_api_parameter_name(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty()
        || !normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
        || normalized
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
    {
        None
    } else {
        Some(normalized.into())
    }
}

pub(crate) fn api_server_slug(value: &str) -> String {
    let slug = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "resource".into()
    } else {
        slug
    }
}

pub(crate) fn zip_project_files(files: Vec<ProjectFile>) -> Result<Vec<u8>, CommandError> {
    let mut output = Cursor::new(Vec::<u8>::new());
    {
        let mut archive = zip::ZipWriter::new(&mut output);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        for file in files {
            archive.start_file(file.path, options).map_err(|error| {
                CommandError::new(
                    "api-server-export-archive-failed",
                    format!("Unable to create the API project archive: {error}"),
                )
            })?;
            archive
                .write_all(file.contents.as_bytes())
                .map_err(|error| {
                    CommandError::new(
                        "api-server-export-archive-failed",
                        format!("Unable to write the API project archive: {error}"),
                    )
                })?;
        }
        archive.finish().map_err(|error| {
            CommandError::new(
                "api-server-export-archive-failed",
                format!("Unable to finish the API project archive: {error}"),
            )
        })?;
    }
    Ok(output.into_inner())
}
