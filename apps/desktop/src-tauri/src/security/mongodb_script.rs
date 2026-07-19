use tree_sitter::{Node, Parser};

use crate::domain::error::CommandError;

const WRITE_METHODS: &[&str] = &[
    "insertone",
    "insertmany",
    "updateone",
    "updatemany",
    "replaceone",
    "findoneandupdate",
    "findoneandreplace",
    "bulkwrite",
    "starttransaction",
    "committransaction",
    "withtransaction",
];
const DESTRUCTIVE_METHODS: &[&str] = &[
    "deleteone",
    "deletemany",
    "findoneanddelete",
    "drop",
    "dropindex",
    "dropindexes",
    "dropdatabase",
    "renamecollection",
];
const ADMIN_METHODS: &[&str] = &[
    "createindex",
    "createindexes",
    "createcollection",
    "runcommand",
    "admincommand",
];
const BLOCKED_HOST_CALLS: &[&str] = &[
    "eval",
    "function",
    "require",
    "import",
    "load",
    "fetch",
    "websocket",
];
const READ_COMMANDS: &[&str] = &[
    "ping",
    "hello",
    "ismaster",
    "buildinfo",
    "collstats",
    "dbstats",
    "listcollections",
    "listindexes",
    "serverstatus",
    "explain",
    "count",
    "distinct",
    "find",
    "aggregate",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct MongoScriptAnalysis {
    pub(crate) looks_write: bool,
    pub(crate) destructive: bool,
    pub(crate) administrative: bool,
    pub(crate) operation_count: usize,
}

impl MongoScriptAnalysis {
    pub(crate) fn confirmation_reason(self) -> Option<&'static str> {
        if self.destructive {
            Some("MongoDB destructive script operations require confirmation before execution.")
        } else if self.administrative {
            Some("MongoDB administrative and server-command script operations require confirmation before execution.")
        } else if self.looks_write {
            Some("MongoDB script write operations require confirmation before execution.")
        } else {
            None
        }
    }
}

pub(crate) fn analyze_mongodb_script(source: &str) -> Result<MongoScriptAnalysis, CommandError> {
    analyze_mongodb_script_internal(source, false)
}

pub(crate) fn analyze_resolved_mongodb_script(
    source: &str,
) -> Result<MongoScriptAnalysis, CommandError> {
    analyze_mongodb_script_internal(source, true)
}

fn analyze_mongodb_script_internal(
    source: &str,
    allow_resolved_credentials: bool,
) -> Result<MongoScriptAnalysis, CommandError> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_javascript::LANGUAGE.into())
        .map_err(|error| CommandError::new("mongodb-script-parser", error.to_string()))?;
    let tree = parser.parse(source, None).ok_or_else(|| {
        CommandError::new(
            "mongodb-script-parser",
            "MongoDB script parsing did not produce a syntax tree.",
        )
    })?;
    let root = tree.root_node();
    if root.has_error() {
        return Err(CommandError::new(
            "mongodb-script-syntax",
            "MongoDB script contains a JavaScript syntax error. Correct the highlighted statement and run it again.",
        ));
    }

    let mut analysis = MongoScriptAnalysis::default();
    visit(
        root,
        source.as_bytes(),
        &mut analysis,
        allow_resolved_credentials,
    )?;
    Ok(analysis)
}

fn visit(
    node: Node<'_>,
    source: &[u8],
    analysis: &mut MongoScriptAnalysis,
    allow_resolved_credentials: bool,
) -> Result<(), CommandError> {
    match node.kind() {
        "import_statement" => return Err(blocked_host_api("import")),
        "call_expression" | "new_expression" => inspect_call(node, source, analysis)?,
        "member_expression" => inspect_method_reference(node, source, analysis),
        "subscript_expression" => inspect_computed_access(node, source)?,
        "pair" => inspect_pair(node, source, analysis, allow_resolved_credentials)?,
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child, source, analysis, allow_resolved_credentials)?;
    }
    Ok(())
}

fn inspect_method_reference(node: Node<'_>, source: &[u8], analysis: &mut MongoScriptAnalysis) {
    if node.parent().is_some_and(|parent| {
        matches!(parent.kind(), "call_expression" | "new_expression")
            && parent
                .child_by_field_name("function")
                .is_some_and(|function| function == node)
    }) {
        return;
    }
    let method = final_member_name(node_text(node, source)).to_ascii_lowercase();
    if WRITE_METHODS.contains(&method.as_str()) {
        analysis.looks_write = true;
    } else if DESTRUCTIVE_METHODS.contains(&method.as_str()) {
        analysis.looks_write = true;
        analysis.destructive = true;
    } else if ADMIN_METHODS.contains(&method.as_str()) {
        analysis.looks_write = true;
        analysis.administrative = true;
    }
}

fn inspect_call(
    node: Node<'_>,
    source: &[u8],
    analysis: &mut MongoScriptAnalysis,
) -> Result<(), CommandError> {
    let function = node
        .child_by_field_name("function")
        .or_else(|| node.child_by_field_name("constructor"));
    let Some(function) = function else {
        return Ok(());
    };
    let text = node_text(function, source);
    let method = final_member_name(text).to_ascii_lowercase();
    if BLOCKED_HOST_CALLS.contains(&method.as_str()) {
        return Err(blocked_host_api(&method));
    }

    if method.is_empty() {
        return Ok(());
    }
    if WRITE_METHODS.contains(&method.as_str()) {
        analysis.looks_write = true;
        analysis.operation_count += 1;
    } else if DESTRUCTIVE_METHODS.contains(&method.as_str()) {
        analysis.looks_write = true;
        analysis.destructive = true;
        analysis.operation_count += 1;
    } else if ADMIN_METHODS.contains(&method.as_str()) {
        analysis.operation_count += 1;
        if matches!(method.as_str(), "runcommand" | "admincommand") {
            let call_text = node_text(node, source);
            let command = command_name_from_call(call_text);
            if command
                .as_deref()
                .is_none_or(|name| !READ_COMMANDS.contains(&name))
            {
                analysis.looks_write = true;
                analysis.administrative = true;
            }
        } else {
            analysis.looks_write = true;
            analysis.administrative = true;
        }
    }
    Ok(())
}

fn inspect_computed_access(node: Node<'_>, source: &[u8]) -> Result<(), CommandError> {
    let index = node.child_by_field_name("index");
    if index.is_some_and(|value| value.kind() == "string") {
        return Ok(());
    }

    let text = node_text(node, source);
    if text.starts_with("db[") || text.contains("db.") || text.contains("getCollection") {
        return Err(CommandError::new(
            "mongodb-script-dynamic-operation",
            "Dynamic MongoDB property access cannot be authorized safely. Use a literal collection name and a direct method call.",
        ));
    }
    Ok(())
}

fn inspect_pair(
    node: Node<'_>,
    source: &[u8],
    analysis: &mut MongoScriptAnalysis,
    allow_resolved_credentials: bool,
) -> Result<(), CommandError> {
    let key = node.child_by_field_name("key");
    let value = node.child_by_field_name("value");
    let Some(key) = key else {
        return Ok(());
    };
    let normalized_key = node_text(key, source)
        .trim_matches(['\'', '"'])
        .to_ascii_lowercase();

    if matches!(normalized_key.as_str(), "$out" | "$merge") {
        analysis.looks_write = true;
        analysis.destructive = true;
    }

    if !allow_resolved_credentials
        && matches!(
            normalized_key.as_str(),
            "pwd" | "password" | "credential" | "credentials"
        )
        && value.is_some_and(|value| {
            value.kind() == "string" && !node_text(value, source).contains("{{")
        })
    {
        return Err(CommandError::new(
            "mongodb-script-credential-literal",
            "Credential values must use an environment secret placeholder such as `{{MONGO_PASSWORD}}`; literal credentials are not allowed in saved scripts.",
        ));
    }
    Ok(())
}

fn command_name_from_call(call: &str) -> Option<String> {
    let object_start = call.find('{')? + 1;
    let rest = call.get(object_start..)?.trim_start();
    let key_end = rest.find([':', ' ', '\t', '\r', '\n'])?;
    let key = rest[..key_end].trim_matches(['\'', '"']);
    (!key.is_empty()).then(|| key.to_ascii_lowercase())
}

fn final_member_name(value: &str) -> &str {
    value
        .rsplit_once('.')
        .map(|(_, method)| method)
        .unwrap_or(value)
        .trim()
}

fn node_text<'a>(node: Node<'_>, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or_default()
}

fn blocked_host_api(name: &str) -> CommandError {
    CommandError::new(
        "mongodb-script-host-api-blocked",
        format!(
            "`{name}` is not available in the MongoDB sandbox. Scripts can access only the database API, BSON constructors, and bounded output helpers."
        ),
    )
}

#[cfg(test)]
#[path = "../../tests/unit/security/mongodb_script_tests.rs"]
mod tests;
