use crate::domain::error::CommandError;
use std::collections::HashMap;
use tree_sitter::Node;

/// Script placeholders are explicit string data. JavaScript `${expression}` is never a template.
pub(super) fn resolve_script_template(
    source: &str,
    variables: &HashMap<String, String>,
) -> Result<String, CommandError> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_javascript::LANGUAGE.into())
        .map_err(|_| {
            CommandError::new(
                "script-template-parser",
                "Script validation is unavailable.",
            )
        })?;
    let tree = parser.parse(source, None).ok_or_else(|| {
        CommandError::new(
            "script-template-parser",
            "Script validation is unavailable.",
        )
    })?;
    let mut edits = Vec::new();
    visit(tree.root_node(), source, variables, &mut edits)?;
    let mut result = source.to_string();
    for (start, end, replacement) in edits.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }
    Ok(result)
}

fn visit(
    node: Node<'_>,
    source: &str,
    variables: &HashMap<String, String>,
    edits: &mut Vec<(usize, usize, String)>,
) -> Result<(), CommandError> {
    let quote = if node.kind() == "string" {
        source.as_bytes().get(node.start_byte()).copied()
    } else if node.kind() == "string_fragment"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "template_string")
    {
        Some(b'`')
    } else {
        None
    };
    if let Some(quote) = quote {
        let text = &source[node.byte_range()];
        let mut cursor = 0;
        while let Some(offset) = text[cursor..].find("{{") {
            let start = cursor + offset;
            let Some(end_offset) = text[start + 2..].find("}}") else {
                break;
            };
            let end = start + 2 + end_offset;
            let key = &text[start + 2..end];
            let preceding_slashes = text[..start]
                .bytes()
                .rev()
                .take_while(|byte| *byte == b'\\')
                .count();
            // An escaped opening brace is literal text, not a substitution point.
            if preceding_slashes % 2 == 0 && super::environments::is_valid_variable_key(key) {
                let value = variables.get(key).ok_or_else(|| CommandError::new("environment-variable-unresolved", format!("Environment variable {key} is not set (script line {}). Configure it in the selected environment.", node.start_position().row + 1)))?;
                let encoded = serde_json::to_string(value).expect("strings serialize");
                let mut escaped = encoded[1..encoded.len() - 1].to_string();
                if quote == b'\'' {
                    escaped = escaped.replace('\'', "\\'");
                }
                if quote == b'`' {
                    escaped = escaped.replace('`', "\\`").replace("${", "\\${");
                }
                edits.push((
                    node.start_byte() + start,
                    node.start_byte() + end + 2,
                    escaped,
                ));
            }
            cursor = end + 2;
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child, source, variables, edits)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/script_templates_tests.rs"]
mod tests;
