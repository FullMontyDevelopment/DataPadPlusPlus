use mongodb::bson::{doc, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::bson_extjson::{
    mongodb_document_to_json, mongodb_json_to_bson, mongodb_json_to_document,
};
use super::connection::{mongodb_client, mongodb_database_name};

const SYSTEM_DATABASES: &[&str] = &["admin", "config", "local"];

pub(crate) async fn execute_mongodb_management_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "mongodb.database.create" => {
            execute_create_database(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.database.drop" => {
            execute_drop_database(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.create" => {
            execute_create_collection(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.drop" => {
            execute_collection_command(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
                "drop",
                "MongoDB dropped collection",
                |collection_name| Ok(doc! { "drop": collection_name }),
            )
            .await
        }
        "mongodb.collection.rename" => {
            execute_rename_collection(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.modify" => {
            execute_modify_collection(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.convert-to-capped" => {
            execute_convert_to_capped(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.clone-as-capped" => {
            execute_clone_as_capped(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.compact" => {
            execute_compact_collection(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.validate" => {
            execute_validate_collection(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        _ => Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        )),
    }
}

async fn execute_create_database(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(database_name) = string_parameter(request, "database")
        .or_else(|| clean_object_name(request.object_name.as_deref()))
    else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB database creation needs a database name.",
        ));
    };
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB database creation needs the first collection name.",
        ));
    };

    let command = create_collection_command(&collection_name, request)?;
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB created database {database_name} with collection {collection_name}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_drop_database(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    if SYSTEM_DATABASES.contains(&database_name.as_str()) {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "DataPad++ blocks dropping MongoDB system databases: admin, config, and local.",
        ));
    }

    let command = doc! { "dropDatabase": 1 };
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!("MongoDB dropped database {database_name}."));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(&database_name, None, &command, &result)),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_create_collection(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB collection creation needs a collection name.",
        ));
    };

    let command = create_collection_command(&collection_name, request)?;
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB created collection {database_name}.{collection_name}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_rename_collection(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB collection rename needs a source collection name.",
        ));
    };
    let Some(new_collection_name) = string_parameter(request, "newCollection")
        .or_else(|| string_parameter(request, "newName"))
        .or_else(|| string_parameter(request, "to"))
    else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB collection rename needs a new collection name.",
        ));
    };
    let target_database =
        string_parameter(request, "targetDatabase").unwrap_or_else(|| database_name.clone());
    let mut command = doc! {
        "renameCollection": format!("{database_name}.{collection_name}"),
        "to": format!("{target_database}.{new_collection_name}"),
    };
    if let Some(drop_target) = bool_parameter(request, "dropTarget") {
        command.insert("dropTarget", drop_target);
    }
    let result = mongodb_client(connection)
        .await?
        .database("admin")
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB renamed collection {database_name}.{collection_name} to {target_database}.{new_collection_name}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_modify_collection(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB collection modification needs a collection name.",
        ));
    };
    let mut command = doc! { "collMod": &collection_name };
    merge_optional_document(&mut command, request, "modification")?;
    merge_optional_document(&mut command, request, "options")?;
    merge_known_coll_mod_fields(&mut command, request)?;
    if command.len() == 1 {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB collMod needs at least one modification option.",
        ));
    }

    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB modified collection {database_name}.{collection_name}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_convert_to_capped(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB convert to capped needs a collection name.",
        ));
    };
    let Some(size) = numeric_parameter(request, "size") else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB convert to capped needs a size in bytes.",
        ));
    };
    let command = doc! { "convertToCapped": &collection_name, "size": size };
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB converted collection {database_name}.{collection_name} to capped storage."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_clone_as_capped(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB clone as capped needs a source collection name.",
        ));
    };
    let Some(target_collection) = string_parameter(request, "targetCollection")
        .or_else(|| string_parameter(request, "toCollection"))
    else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB clone as capped needs a target collection name.",
        ));
    };
    let Some(size) = numeric_parameter(request, "size") else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            "MongoDB clone as capped needs a size in bytes.",
        ));
    };
    let command = doc! {
        "cloneCollectionAsCapped": &collection_name,
        "toCollection": &target_collection,
        "size": size,
    };
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "MongoDB cloned {database_name}.{collection_name} as capped collection {target_collection}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_compact_collection(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    execute_collection_command(
        connection,
        request,
        operation,
        plan,
        messages,
        warnings,
        "compact",
        "MongoDB compacted collection",
        |collection_name| {
            let mut command = doc! { "compact": collection_name };
            if let Some(force) = bool_parameter(request, "force") {
                command.insert("force", force);
            }
            merge_optional_document(&mut command, request, "options")?;
            Ok(command)
        },
    )
    .await
}

async fn execute_validate_collection(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    execute_collection_command(
        connection,
        request,
        operation,
        plan,
        messages,
        warnings,
        "validate",
        "MongoDB validated collection",
        |collection_name| {
            let mut command = doc! { "validate": collection_name };
            if let Some(full) = bool_parameter(request, "full") {
                command.insert("full", full);
            }
            merge_optional_document(&mut command, request, "options")?;
            Ok(command)
        },
    )
    .await
}

async fn execute_collection_command<F>(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
    action: &str,
    success_prefix: &str,
    command_builder: F,
) -> Result<OperationExecutionResponse, CommandError>
where
    F: FnOnce(&str) -> Result<Document, CommandError>,
{
    let database_name = workflow_database_name(connection, request);
    let Some(collection_name) = workflow_collection_name(request) else {
        return Ok(missing_parameter_response(
            request,
            operation,
            plan,
            messages.clone(),
            warnings.clone(),
            &format!("MongoDB collection {action} needs a collection name."),
        ));
    };
    let command = command_builder(&collection_name)?;
    let result = mongodb_client(connection)
        .await?
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    messages.push(format!(
        "{success_prefix} {database_name}.{collection_name}."
    ));
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(command_metadata(
            &database_name,
            Some(&collection_name),
            &command,
            &result,
        )),
        messages.clone(),
        warnings.clone(),
    ))
}

fn create_collection_command(
    collection_name: &str,
    request: &OperationExecutionRequest,
) -> Result<Document, CommandError> {
    let mut command = doc! { "create": collection_name };
    merge_optional_document(&mut command, request, "options")?;
    Ok(command)
}

fn merge_optional_document(
    command: &mut Document,
    request: &OperationExecutionRequest,
    key: &str,
) -> Result<(), CommandError> {
    let Some(value) = request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
    else {
        return Ok(());
    };
    if value.is_null() {
        return Ok(());
    }
    let document =
        mongodb_json_to_document(value, "management options", "mongodb-management-options")?;
    for (name, value) in document {
        command.insert(name, value);
    }
    Ok(())
}

fn merge_known_coll_mod_fields(
    command: &mut Document,
    request: &OperationExecutionRequest,
) -> Result<(), CommandError> {
    for key in [
        "validator",
        "validationLevel",
        "validationAction",
        "index",
        "changeStreamPreAndPostImages",
        "expireAfterSeconds",
    ] {
        if let Some(value) = request
            .parameters
            .as_ref()
            .and_then(|values| values.get(key))
        {
            command.insert(
                key,
                mongodb_json_to_bson(value, "mongodb-management-options")?,
            );
        }
    }
    Ok(())
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    executed: bool,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support.clone(),
        executed,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

fn missing_parameter_response(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: Vec<String>,
    mut warnings: Vec<String>,
    warning: &str,
) -> OperationExecutionResponse {
    warnings.push(warning.into());
    operation_response(request, operation, plan, false, None, messages, warnings)
}

fn workflow_database_name(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> String {
    string_parameter(request, "database")
        .or_else(|| clean_object_name(request.object_name.as_deref()))
        .unwrap_or_else(|| mongodb_database_name(connection))
}

fn workflow_collection_name(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "collection")
        .or_else(|| clean_object_name(request.object_name.as_deref()))
}

fn clean_object_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with('<'))
        .map(str::to_string)
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with('<'))
        .map(str::to_string)
}

fn bool_parameter(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "1" => Some(true),
                        "false" | "no" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

fn numeric_parameter(request: &OperationExecutionRequest, key: &str) -> Option<i64> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
                .or_else(|| {
                    value
                        .as_str()
                        .and_then(|raw| raw.trim().parse::<i64>().ok())
                })
        })
        .filter(|value| *value > 0)
}

fn command_metadata(
    database_name: &str,
    collection_name: Option<&str>,
    command: &Document,
    result: &Document,
) -> Value {
    json!({
        "database": database_name,
        "collection": collection_name,
        "command": mongodb_document_to_json(command),
        "result": mongodb_document_to_json(result),
    })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/management_tests.rs"]
mod management_tests;
