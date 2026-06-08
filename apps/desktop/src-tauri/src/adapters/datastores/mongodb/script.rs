use futures_util::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Bson, DateTime, Document};
use serde_json::{json, Number, Value};

use super::super::super::*;
use super::bson_extjson::{mongodb_document_to_json, mongodb_documents_to_json};
use super::connection::{
    mongodb_client, mongodb_database_name, mongodb_database_name_for_collection_query,
};
use super::MongoDbAdapter;

#[derive(Debug)]
enum MongoScriptOperation {
    Find {
        collection: String,
        filter: Value,
        projection: Option<Value>,
        sort: Option<Value>,
        skip: Option<u64>,
        limit: Option<u32>,
    },
    Aggregate {
        collection: String,
        pipeline: Vec<Value>,
    },
    RunCommand {
        command: Value,
    },
}

pub(super) async fn execute_mongodb_script(
    adapter: &MongoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let client = mongodb_client(connection).await?;
    let mut notices = notices;
    let script = selected_query(request);
    let operations = parse_mongo_script(script)?;
    let requested_row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let mut remaining = requested_row_limit;
    let mut documents = Vec::<Document>::new();
    let mut statement_results = Vec::<Value>::new();
    let mut batch_sections = Vec::<Value>::new();
    let mut truncated = false;

    for (index, operation) in operations.into_iter().enumerate() {
        if remaining == 0 {
            truncated = true;
            break;
        }

        match operation {
            MongoScriptOperation::Find {
                collection,
                filter,
                projection,
                sort,
                skip,
                limit,
            } => {
                let input = json!({ "collection": collection });
                let database_resolution = mongodb_database_name_for_collection_query(
                    &client,
                    connection,
                    &input,
                    &collection,
                )
                .await;
                if let Some(notice) = database_resolution.notice {
                    notices.push(notice);
                }
                let collection_handle = client
                    .database(&database_resolution.database_name)
                    .collection::<Document>(&collection);
                let effective_limit = limit.unwrap_or(remaining).min(remaining);
                let mut find = collection_handle
                    .find(value_to_document(&filter)?)
                    .limit(i64::from(effective_limit + 1));

                if let Some(projection) = projection {
                    find = find.projection(value_to_document(&projection)?);
                }

                if let Some(sort) = sort {
                    find = find.sort(value_to_document(&sort)?);
                }

                if let Some(skip) = skip {
                    find = find.skip(skip);
                }

                let mut result_documents = find.await?.try_collect::<Vec<Document>>().await?;
                if result_documents.len() > effective_limit as usize {
                    truncated = true;
                    result_documents.truncate(effective_limit as usize);
                }
                let section_documents = mongodb_documents_to_json(result_documents.iter());
                let section_payloads = vec![
                    payload_document(section_documents.clone()),
                    payload_json(json!({
                        "statement": index + 1,
                        "operation": "find",
                        "collection": collection.clone(),
                        "documents": section_documents.clone(),
                    })),
                ];
                remaining = remaining.saturating_sub(result_documents.len() as u32);
                statement_results.push(json!({
                    "statement": index + 1,
                    "operation": "find",
                    "collection": collection,
                    "documents": section_documents.clone(),
                }));
                batch_sections.push(batch_section(BatchSectionPayload {
                    id: format!("mongodb-script-{}", index + 1),
                    label: format!("Statement {}", index + 1),
                    statement: Some(script_statement_preview(script, index)),
                    status: "success",
                    duration_ms: None,
                    row_count: Some(result_documents.len()),
                    default_renderer: "document".into(),
                    renderer_modes: vec!["document".into(), "json".into()],
                    payloads: section_payloads,
                    notices: Vec::new(),
                }));
                documents.extend(result_documents);
            }
            MongoScriptOperation::Aggregate {
                collection,
                pipeline,
            } => {
                let input = json!({ "collection": collection });
                let database_resolution = mongodb_database_name_for_collection_query(
                    &client,
                    connection,
                    &input,
                    &collection,
                )
                .await;
                if let Some(notice) = database_resolution.notice {
                    notices.push(notice);
                }
                let collection_handle = client
                    .database(&database_resolution.database_name)
                    .collection::<Document>(&collection);
                let mut pipeline = pipeline
                    .iter()
                    .map(value_to_document)
                    .collect::<Result<Vec<Document>, _>>()?;
                pipeline.push(doc! { "$limit": i64::from(remaining + 1) });
                let mut result_documents = collection_handle
                    .aggregate(pipeline)
                    .await?
                    .try_collect::<Vec<Document>>()
                    .await?;
                if result_documents.len() > remaining as usize {
                    truncated = true;
                    result_documents.truncate(remaining as usize);
                }
                let section_documents = mongodb_documents_to_json(result_documents.iter());
                let section_payloads = vec![
                    payload_document(section_documents.clone()),
                    payload_json(json!({
                        "statement": index + 1,
                        "operation": "aggregate",
                        "collection": collection.clone(),
                        "documents": section_documents.clone(),
                    })),
                ];
                remaining = remaining.saturating_sub(result_documents.len() as u32);
                statement_results.push(json!({
                    "statement": index + 1,
                    "operation": "aggregate",
                    "collection": collection,
                    "documents": section_documents.clone(),
                }));
                batch_sections.push(batch_section(BatchSectionPayload {
                    id: format!("mongodb-script-{}", index + 1),
                    label: format!("Statement {}", index + 1),
                    statement: Some(script_statement_preview(script, index)),
                    status: "success",
                    duration_ms: None,
                    row_count: Some(result_documents.len()),
                    default_renderer: "document".into(),
                    renderer_modes: vec!["document".into(), "json".into()],
                    payloads: section_payloads,
                    notices: Vec::new(),
                }));
                documents.extend(result_documents);
            }
            MongoScriptOperation::RunCommand { command } => {
                let database = client.database(&mongodb_database_name(connection));
                let command = value_to_document(&command)?;
                let command_result = database.run_command(command).await?;
                let command_result_json = mongodb_document_to_json(&command_result);
                statement_results.push(json!({
                    "statement": index + 1,
                    "operation": "runCommand",
                    "result": command_result_json.clone(),
                }));
                batch_sections.push(batch_section(BatchSectionPayload {
                    id: format!("mongodb-script-{}", index + 1),
                    label: format!("Statement {}", index + 1),
                    statement: Some(script_statement_preview(script, index)),
                    status: "success",
                    duration_ms: None,
                    row_count: Some(1),
                    default_renderer: "json".into(),
                    renderer_modes: vec!["json".into(), "document".into()],
                    payloads: vec![
                        payload_json(json!({
                            "statement": index + 1,
                            "operation": "runCommand",
                            "result": command_result_json.clone(),
                        })),
                        payload_document(json!([command_result_json])),
                    ],
                    notices: Vec::new(),
                }));
                documents.push(command_result);
                remaining = remaining.saturating_sub(1);
            }
        }
    }

    let documents_json = mongodb_documents_to_json(documents.iter());
    let json_payload = json!({
        "statements": statement_results,
        "documents": documents_json,
    });
    let raw_documents = serde_json::to_string_pretty(&json_payload).unwrap_or_else(|_| "[]".into());
    let table_rows = documents_json
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| vec![serde_json::to_string(item).unwrap_or_else(|_| "{}".into())])
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let batch_payload = (batch_sections.len() > 1).then(|| {
        payload_batch(
            batch_sections,
            format!(
                "{} MongoDB script statement(s) returned {} document(s).",
                statement_results.len(),
                documents.len()
            ),
        )
    });
    let mut payloads = Vec::new();
    if let Some(payload) = batch_payload.clone() {
        payloads.push(payload);
    }
    payloads.extend([
        payload_document(documents_json.clone()),
        payload_json(json_payload),
        payload_table(vec!["document".into()], table_rows),
        payload_raw(raw_documents),
    ]);

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "{} document(s) returned from MongoDB script on {}.",
            documents.len(),
            connection.name
        ),
        default_renderer: if batch_payload.is_some() {
            "batch"
        } else {
            "document"
        },
        renderer_modes: if batch_payload.is_some() {
            vec!["batch", "document", "json", "table", "raw"]
        } else {
            vec!["document", "json", "table", "raw"]
        },
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(requested_row_limit),
        truncated,
        explain_payload: None,
    }))
}

fn script_statement_preview(script: &str, index: usize) -> String {
    split_statements(script)
        .get(index)
        .cloned()
        .unwrap_or_else(|| format!("Statement {}", index + 1))
}

fn parse_mongo_script(script: &str) -> Result<Vec<MongoScriptOperation>, CommandError> {
    reject_unsafe_script(script)?;
    let statements = split_statements(script);

    if statements.is_empty() {
        return Err(CommandError::new(
            "mongodb-script-empty",
            "Enter at least one supported MongoDB script statement.",
        ));
    }

    statements
        .into_iter()
        .map(|statement| parse_statement(&statement))
        .collect()
}

fn reject_unsafe_script(script: &str) -> Result<(), CommandError> {
    let lower = script.to_ascii_lowercase();
    let blocked = [
        ".insert",
        ".update",
        ".delete",
        ".remove",
        ".drop",
        ".create",
        ".replace",
        ".bulk",
        ".findoneand",
        "$out",
        "$merge",
        "function",
        "=>",
        "for ",
        "while ",
        "import ",
        "require(",
        "eval(",
    ];

    if let Some(token) = blocked.iter().find(|token| lower.contains(**token)) {
        return Err(CommandError::new(
            "mongodb-script-blocked",
            format!(
                "MongoDB scripting supports read-oriented statements only. `{token}` is not allowed here."
            ),
        ));
    }

    Ok(())
}

fn parse_statement(statement: &str) -> Result<MongoScriptOperation, CommandError> {
    let statement = statement.trim();

    if let Some(arguments) = call_arguments(statement, "db.runCommand") {
        let command = shell_value_to_json(arguments.trim())?;
        validate_read_command(&command)?;
        return Ok(MongoScriptOperation::RunCommand { command });
    }

    let (collection, remainder) = parse_collection_prefix(statement)?;

    if let Some(arguments) = call_arguments(remainder, "find") {
        let args = split_top_level(arguments, ',');
        let filter = args
            .first()
            .filter(|value| !value.trim().is_empty())
            .map(|value| shell_value_to_json(value))
            .transpose()?
            .unwrap_or_else(|| json!({}));
        let projection = args
            .get(1)
            .filter(|value| !value.trim().is_empty())
            .map(|value| shell_value_to_json(value))
            .transpose()?;
        let sort = chained_call_value(remainder, "sort")?;
        let skip = chained_call_number(remainder, "skip")?.map(|value| value as u64);
        let limit =
            chained_call_number(remainder, "limit")?.and_then(|value| u32::try_from(value).ok());

        return Ok(MongoScriptOperation::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        });
    }

    if let Some(arguments) = call_arguments(remainder, "aggregate") {
        let pipeline = shell_value_to_json(arguments.trim())?;
        let pipeline = pipeline.as_array().cloned().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-pipeline",
                "MongoDB aggregate scripts must pass an array pipeline.",
            )
        })?;
        return Ok(MongoScriptOperation::Aggregate {
            collection,
            pipeline,
        });
    }

    Err(CommandError::new(
        "mongodb-script-unsupported",
        "Supported MongoDB scripts are find(), aggregate(), getCollection(...), and read-only runCommand(...).",
    ))
}

fn parse_collection_prefix(statement: &str) -> Result<(String, &str), CommandError> {
    let statement = statement.trim();

    if let Some(after_db) = statement.strip_prefix("db.") {
        if let Some(arguments) = call_arguments(after_db, "getCollection") {
            let collection = shell_value_to_json(arguments)?
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| {
                    CommandError::new(
                        "mongodb-script-collection",
                        "db.getCollection(...) requires a string collection name.",
                    )
                })?;
            let close_index = call_end_index(after_db, "getCollection").ok_or_else(|| {
                CommandError::new(
                    "mongodb-script-collection",
                    "Could not parse db.getCollection(...) in the MongoDB script.",
                )
            })?;
            let remainder = after_db[close_index..].trim_start_matches('.');
            return Ok((collection, remainder));
        }

        let mut parts = after_db.splitn(2, '.');
        let collection = parts.next().unwrap_or_default().trim();
        let remainder = parts.next().unwrap_or_default();

        if is_identifier(collection) && !remainder.is_empty() {
            return Ok((collection.into(), remainder));
        }
    }

    Err(CommandError::new(
        "mongodb-script-collection",
        "MongoDB scripts must start with db.collection or db.getCollection(\"collection\").",
    ))
}

fn validate_read_command(command: &Value) -> Result<(), CommandError> {
    let command_name = command
        .as_object()
        .and_then(|object| object.keys().next())
        .map(|key| key.as_str())
        .unwrap_or_default();
    let allowed = [
        "aggregate",
        "buildInfo",
        "collStats",
        "count",
        "dbStats",
        "distinct",
        "explain",
        "find",
        "listCollections",
        "listIndexes",
        "ping",
        "serverStatus",
    ];

    if allowed
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(command_name))
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "mongodb-script-command-blocked",
            format!("`db.runCommand` command `{command_name}` is not enabled in scripting view."),
        ))
    }
}

fn call_arguments<'a>(source: &'a str, call_name: &str) -> Option<&'a str> {
    let start = source.find(&format!("{call_name}("))? + call_name.len();
    let chars: Vec<char> = source.chars().collect();
    let open_index = source[..start].chars().count();
    let close_index = matching_delimiter(&chars, open_index, '(', ')')?;
    Some(
        &source[source.char_indices().nth(open_index + 1)?.0
            ..source.char_indices().nth(close_index)?.0],
    )
}

fn call_end_index(source: &str, call_name: &str) -> Option<usize> {
    let start = source.find(&format!("{call_name}("))? + call_name.len();
    let chars: Vec<char> = source.chars().collect();
    let open_index = source[..start].chars().count();
    let close_index = matching_delimiter(&chars, open_index, '(', ')')?;
    source
        .char_indices()
        .nth(close_index + 1)
        .map(|(index, _)| index)
        .or(Some(source.len()))
}

fn chained_call_value(source: &str, call_name: &str) -> Result<Option<Value>, CommandError> {
    call_arguments(source, call_name)
        .map(shell_value_to_json)
        .transpose()
}

fn chained_call_number(source: &str, call_name: &str) -> Result<Option<i64>, CommandError> {
    let Some(arguments) = call_arguments(source, call_name) else {
        return Ok(None);
    };

    arguments.trim().parse::<i64>().map(Some).map_err(|_| {
        CommandError::new(
            "mongodb-script-number",
            format!("MongoDB `{call_name}` expects a numeric argument."),
        )
    })
}

fn shell_value_to_json(input: &str) -> Result<Value, CommandError> {
    let normalized =
        quote_unquoted_keys(&replace_shell_constructors(&single_to_double_quotes(input)));
    serde_json::from_str(&normalized).map_err(|error| {
        CommandError::new(
            "mongodb-script-json",
            format!("Could not parse MongoDB script argument as JSON-like data: {error}"),
        )
    })
}

fn value_to_document(value: &Value) -> Result<Document, CommandError> {
    match json_to_bson(value)? {
        Bson::Document(document) => Ok(document),
        _ => Err(CommandError::new(
            "mongodb-script-document",
            "MongoDB script arguments must evaluate to an object document.",
        )),
    }
}

fn json_to_bson(value: &Value) -> Result<Bson, CommandError> {
    match value {
        Value::Null => Ok(Bson::Null),
        Value::Bool(value) => Ok(Bson::Boolean(*value)),
        Value::Number(value) => json_number_to_bson(value),
        Value::String(value) => Ok(Bson::String(value.clone())),
        Value::Array(values) => values
            .iter()
            .map(json_to_bson)
            .collect::<Result<Vec<Bson>, _>>()
            .map(Bson::Array),
        Value::Object(object) => {
            if object.len() == 1 {
                if let Some(oid) = object.get("$oid").and_then(Value::as_str) {
                    return ObjectId::parse_str(oid)
                        .map(Bson::ObjectId)
                        .map_err(|error| {
                            CommandError::new("mongodb-script-objectid", error.to_string())
                        });
                }

                if let Some(date) = object.get("$date").and_then(Value::as_str) {
                    return DateTime::parse_rfc3339_str(date)
                        .map(Bson::DateTime)
                        .map_err(|error| {
                            CommandError::new("mongodb-script-date", error.to_string())
                        });
                }

                if let Some(number_long) = object.get("$numberLong").and_then(Value::as_str) {
                    return number_long
                        .parse::<i64>()
                        .map(Bson::Int64)
                        .map_err(|error| {
                            CommandError::new("mongodb-script-numberlong", error.to_string())
                        });
                }
            }

            let mut document = Document::new();
            for (key, value) in object {
                document.insert(key, json_to_bson(value)?);
            }
            Ok(Bson::Document(document))
        }
    }
}

fn json_number_to_bson(value: &Number) -> Result<Bson, CommandError> {
    if let Some(value) = value.as_i64() {
        if let Ok(value) = i32::try_from(value) {
            return Ok(Bson::Int32(value));
        }

        return Ok(Bson::Int64(value));
    }

    if let Some(value) = value.as_f64() {
        return Ok(Bson::Double(value));
    }

    Err(CommandError::new(
        "mongodb-script-number",
        "MongoDB script number could not be represented as BSON.",
    ))
}

fn replace_shell_constructors(input: &str) -> String {
    let mut output = input.to_string();

    for constructor in ["ObjectId", "ISODate", "NumberLong"] {
        output = replace_constructor(&output, constructor);
    }

    output
}

fn replace_constructor(input: &str, constructor: &str) -> String {
    let mut output = String::new();
    let mut index = 0;
    let needle = format!("{constructor}(");

    while let Some(relative_start) = input[index..].find(&needle) {
        let start = index + relative_start;
        output.push_str(&input[index..start]);
        let argument_start = start + needle.len();
        let chars: Vec<char> = input.chars().collect();
        let open_char_index = input[..argument_start - 1].chars().count();
        let Some(close_char_index) = matching_delimiter(&chars, open_char_index, '(', ')') else {
            output.push_str(&input[start..]);
            return output;
        };
        let close_byte_index = input
            .char_indices()
            .nth(close_char_index)
            .map(|(byte_index, _)| byte_index)
            .unwrap_or(input.len());
        let after_close_byte_index = input
            .char_indices()
            .nth(close_char_index + 1)
            .map(|(byte_index, _)| byte_index)
            .unwrap_or(input.len());
        let raw_argument = input[argument_start..close_byte_index]
            .trim()
            .trim_matches('"')
            .trim_matches('\'');
        let key = match constructor {
            "ObjectId" => "$oid",
            "ISODate" => "$date",
            "NumberLong" => "$numberLong",
            _ => constructor,
        };
        output.push_str(&format!("{{\"{key}\":\"{raw_argument}\"}}"));
        index = after_close_byte_index;
    }

    output.push_str(&input[index..]);
    output
}

fn single_to_double_quotes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_double = false;
    let mut in_single = false;
    let mut escaped = false;

    for character in input.chars() {
        if escaped {
            output.push(character);
            escaped = false;
            continue;
        }

        if character == '\\' {
            output.push(character);
            escaped = true;
            continue;
        }

        match character {
            '"' if !in_single => {
                in_double = !in_double;
                output.push(character);
            }
            '\'' if !in_double => {
                in_single = !in_single;
                output.push('"');
            }
            _ => output.push(character),
        }
    }

    output
}

fn quote_unquoted_keys(input: &str) -> String {
    let value: Value = match serde_json::from_str::<Value>(input) {
        Ok(value) => return serde_json::to_string(&value).unwrap_or_else(|_| input.into()),
        Err(_) => Value::Null,
    };
    if !value.is_null() {
        return input.into();
    }

    let mut output = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < chars.len() {
        let character = chars[index];

        if escaped {
            output.push(character);
            escaped = false;
            index += 1;
            continue;
        }

        if character == '\\' {
            output.push(character);
            escaped = true;
            index += 1;
            continue;
        }

        if character == '"' {
            in_string = !in_string;
            output.push(character);
            index += 1;
            continue;
        }

        if !in_string && (character == '{' || character == ',') {
            output.push(character);
            index += 1;
            while index < chars.len() && chars[index].is_whitespace() {
                output.push(chars[index]);
                index += 1;
            }
            let key_start = index;
            if index < chars.len() && is_identifier_start(chars[index]) {
                index += 1;
                while index < chars.len() && is_identifier_part(chars[index]) {
                    index += 1;
                }
                let mut probe = index;
                while probe < chars.len() && chars[probe].is_whitespace() {
                    probe += 1;
                }
                if probe < chars.len() && chars[probe] == ':' {
                    let key: String = chars[key_start..index].iter().collect();
                    output.push('"');
                    output.push_str(&key);
                    output.push('"');
                    continue;
                }
            }
            output.extend(chars[key_start..index].iter());
            continue;
        }

        output.push(character);
        index += 1;
    }

    output
}

fn split_statements(script: &str) -> Vec<String> {
    split_top_level(script, ';')
        .into_iter()
        .flat_map(|statement| split_top_level_newline_statements(&statement))
        .map(|statement| statement.trim().to_string())
        .filter(|statement| !statement.is_empty())
        .collect()
}

fn split_top_level_newline_statements(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut stack = Vec::new();
    let mut in_string: Option<char> = None;
    let mut escaped = false;
    let chars = input.chars().collect::<Vec<char>>();
    let mut index = 0;

    while index < chars.len() {
        let character = chars[index];

        if escaped {
            current.push(character);
            escaped = false;
            index += 1;
            continue;
        }

        if character == '\\' {
            current.push(character);
            escaped = true;
            index += 1;
            continue;
        }

        if let Some(quote) = in_string {
            if character == quote {
                in_string = None;
            }
            current.push(character);
            index += 1;
            continue;
        }

        match character {
            '"' | '\'' => {
                in_string = Some(character);
                current.push(character);
            }
            '(' | '[' | '{' => {
                stack.push(character);
                current.push(character);
            }
            ')' | ']' | '}' => {
                stack.pop();
                current.push(character);
            }
            '\n' | '\r' if stack.is_empty() && next_non_whitespace_starts_db(&chars, index + 1) => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(character),
        }

        index += 1;
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn next_non_whitespace_starts_db(chars: &[char], mut index: usize) -> bool {
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }

    chars.get(index) == Some(&'d')
        && chars.get(index + 1) == Some(&'b')
        && matches!(chars.get(index + 2), Some('.') | Some('['))
}

fn split_top_level(input: &str, delimiter: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut stack = Vec::new();
    let mut in_string: Option<char> = None;
    let mut escaped = false;

    for character in input.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }

        if character == '\\' {
            current.push(character);
            escaped = true;
            continue;
        }

        if let Some(quote) = in_string {
            if character == quote {
                in_string = None;
            }
            current.push(character);
            continue;
        }

        match character {
            '"' | '\'' => {
                in_string = Some(character);
                current.push(character);
            }
            '(' | '[' | '{' => {
                stack.push(character);
                current.push(character);
            }
            ')' | ']' | '}' => {
                stack.pop();
                current.push(character);
            }
            item if item == delimiter && stack.is_empty() => {
                parts.push(current);
                current = String::new();
            }
            _ => current.push(character),
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn matching_delimiter(chars: &[char], open_index: usize, open: char, close: char) -> Option<usize> {
    if chars.get(open_index) != Some(&open) {
        return None;
    }

    let mut depth = 0;
    let mut in_string: Option<char> = None;
    let mut escaped = false;

    for (index, character) in chars.iter().enumerate().skip(open_index) {
        if escaped {
            escaped = false;
            continue;
        }

        if *character == '\\' {
            escaped = true;
            continue;
        }

        if let Some(quote) = in_string {
            if *character == quote {
                in_string = None;
            }
            continue;
        }

        if *character == '"' || *character == '\'' {
            in_string = Some(*character);
            continue;
        }

        if *character == open {
            depth += 1;
        } else if *character == close {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }

    None
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(is_identifier_start) && chars.all(is_identifier_part)
}

fn is_identifier_start(character: char) -> bool {
    character == '_' || character == '$' || character.is_ascii_alphabetic()
}

fn is_identifier_part(character: char) -> bool {
    is_identifier_start(character) || character.is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_find_with_chain_and_shell_values() {
        let operations = parse_mongo_script(
            "db.products.find({ sku: 'luna', _id: ObjectId('690000000000000000000001') }, { sku: 1 }).sort({ sku: -1 }).skip(2).limit(5);",
        )
        .unwrap();

        assert_eq!(operations.len(), 1);
        match &operations[0] {
            MongoScriptOperation::Find {
                collection,
                filter,
                projection,
                sort,
                skip,
                limit,
            } => {
                assert_eq!(collection, "products");
                assert_eq!(filter["sku"], "luna");
                assert!(filter["_id"].get("$oid").is_some());
                assert_eq!(projection.as_ref().unwrap()["sku"], 1);
                assert_eq!(sort.as_ref().unwrap()["sku"], -1);
                assert_eq!(*skip, Some(2));
                assert_eq!(*limit, Some(5));
            }
            _ => panic!("expected find"),
        }
    }

    #[test]
    fn parses_get_collection_aggregate() {
        let operations = parse_mongo_script(
            "db.getCollection(\"orders\").aggregate([{ $match: { status: \"open\" } }])",
        )
        .unwrap();

        match &operations[0] {
            MongoScriptOperation::Aggregate {
                collection,
                pipeline,
            } => {
                assert_eq!(collection, "orders");
                assert_eq!(pipeline[0]["$match"]["status"], "open");
            }
            _ => panic!("expected aggregate"),
        }
    }

    #[test]
    fn parses_multiple_newline_separated_statements() {
        let operations = parse_mongo_script(
            "db.products.find({ sku: 'luna-lamp' }).limit(1)\ndb.orders.find({ status: 'open' }).limit(2)",
        )
        .unwrap();

        assert_eq!(operations.len(), 2);
        match (&operations[0], &operations[1]) {
            (
                MongoScriptOperation::Find {
                    collection: first,
                    limit: first_limit,
                    ..
                },
                MongoScriptOperation::Find {
                    collection: second,
                    limit: second_limit,
                    ..
                },
            ) => {
                assert_eq!(first, "products");
                assert_eq!(*first_limit, Some(1));
                assert_eq!(second, "orders");
                assert_eq!(*second_limit, Some(2));
            }
            _ => panic!("expected find statements"),
        }
    }

    #[test]
    fn blocks_mutating_script_calls() {
        let error = parse_mongo_script("db.products.updateOne({ sku: 'a' }, { $set: { x: 1 } })")
            .unwrap_err();

        assert_eq!(error.code, "mongodb-script-blocked");
    }

    #[test]
    fn blocks_write_run_command() {
        let error = parse_mongo_script("db.runCommand({ drop: 'products' })").unwrap_err();

        assert_eq!(error.code, "mongodb-script-command-blocked");
    }

    #[test]
    fn converts_shell_extended_values_to_bson() {
        let value = shell_value_to_json(
            "{ _id: ObjectId('690000000000000000000001'), at: ISODate('2026-05-18T00:00:00Z'), n: NumberLong('42') }",
        )
        .unwrap();
        let document = value_to_document(&value).unwrap();

        assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
        assert!(matches!(document.get("at"), Some(Bson::DateTime(_))));
        assert!(matches!(document.get("n"), Some(Bson::Int64(42))));
    }
}
