use std::collections::BTreeMap;

use mongodb::bson::{doc, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::connection::mongodb_client;

pub(super) fn is_principal_operation(id: &str) -> bool {
    matches!(
        id,
        "mongodb.user.create"
            | "mongodb.user.update"
            | "mongodb.user.drop"
            | "mongodb.role.create"
            | "mongodb.role.update"
            | "mongodb.role.drop"
    )
}

fn invalid(message: &str) -> CommandError {
    CommandError::new("mongodb-principal-invalid", message)
}

// BSON serialization, not Extended JSON interpretation: these are command options,
// not documents. In particular, a principal name must never become an operator.
pub(super) fn principal_command(
    id: &str,
    object_name: Option<&str>,
    parameters: &BTreeMap<String, Value>,
) -> Result<(String, Document), CommandError> {
    let (user, action, command_name) = match id {
        "mongodb.user.create" => (true, "create", "createUser"),
        "mongodb.user.update" => (true, "update", "updateUser"),
        "mongodb.user.drop" => (true, "drop", "dropUser"),
        "mongodb.role.create" => (false, "create", "createRole"),
        "mongodb.role.update" => (false, "update", "updateRole"),
        "mongodb.role.drop" => (false, "drop", "dropRole"),
        _ => return Err(invalid("Unsupported MongoDB principal operation.")),
    };
    let database = parameters
        .get("database")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .ok_or_else(|| invalid("Choose the database that owns this user or role."))?;
    let name = parameters
        .get("name")
        .and_then(Value::as_str)
        .or(object_name)
        .filter(|s| !s.trim().is_empty() && !s.contains('\0'))
        .ok_or_else(|| invalid("A user or role name is required."))?;
    if object_name.is_some_and(|object| object != name) {
        return Err(invalid(
            "The selected principal and command name must match.",
        ));
    }
    let mut command = doc! { (command_name): name };
    let allowed = if action == "drop" {
        &["database", "name"][..]
    } else if user {
        &[
            "database",
            "name",
            "password",
            "roles",
            "customData",
            "mechanisms",
            "authenticationRestrictions",
        ][..]
    } else {
        &[
            "database",
            "name",
            "roles",
            "privileges",
            "authenticationRestrictions",
        ][..]
    };
    if parameters
        .keys()
        .any(|key| !allowed.contains(&key.as_str()))
    {
        return Err(invalid(
            "Unsupported user or role option. Refresh the management view.",
        ));
    }
    for (key, value) in parameters {
        match key.as_str() {
            "database" | "name" => continue,
            "password" if database == "$external" || value.as_str().is_none_or(str::is_empty) => {
                return Err(invalid("A non-empty password is required for password authentication; $external users must not have a password."));
            }
            "roles" => {
                let roles = value
                    .as_array()
                    .ok_or_else(|| invalid("Roles must be an array."))?;
                for role in roles {
                    let valid = role.as_object().is_some_and(|r| {
                        r.len() == 2
                            && ["role", "db"].iter().all(|key| {
                                r.get(*key)
                                    .and_then(Value::as_str)
                                    .is_some_and(|v| !v.trim().is_empty() && !v.contains('\0'))
                            })
                    });
                    if !valid {
                        return Err(invalid("Each role needs a role name and database."));
                    }
                }
            }
            "privileges" => {
                let privileges = value
                    .as_array()
                    .ok_or_else(|| invalid("Privileges must be an array."))?;
                for privilege in privileges {
                    let resource = privilege.get("resource").and_then(Value::as_object);
                    let valid_resource = resource.is_some_and(|r| {
                        (r.len() == 2
                            && ["db", "collection"]
                                .iter()
                                .all(|key| r.get(*key).is_some_and(Value::is_string)))
                            || (r.len() == 1
                                && ["cluster", "anyResource"]
                                    .iter()
                                    .any(|key| r.get(*key) == Some(&Value::Bool(true))))
                    });
                    let valid_actions = privilege
                        .get("actions")
                        .and_then(Value::as_array)
                        .is_some_and(|a| {
                            !a.is_empty()
                                && a.iter()
                                    .all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
                        });
                    if !valid_resource
                        || !valid_actions
                        || privilege.as_object().is_none_or(|p| p.len() != 2)
                    {
                        return Err(invalid("Each privilege needs a native resource and a non-empty list of actions."));
                    }
                }
            }
            "customData" if !value.is_object() => {
                return Err(invalid("Custom data must be a JSON object."))
            }
            "mechanisms"
                if value.as_array().is_none_or(|a| {
                    a.is_empty()
                        || a.iter()
                            .any(|v| !matches!(v.as_str(), Some("SCRAM-SHA-1" | "SCRAM-SHA-256")))
                }) =>
            {
                return Err(invalid(
                    "Choose SCRAM-SHA-1 and/or SCRAM-SHA-256 authentication mechanisms.",
                ));
            }
            "authenticationRestrictions"
                if value.as_array().is_none_or(|a| {
                    a.iter().any(|v| {
                        v.as_object().is_none_or(|r| {
                            r.is_empty()
                                || r.iter().any(|(k, v)| {
                                    !matches!(k.as_str(), "clientSource" | "serverAddress")
                                        || v.as_array().is_none_or(|a| {
                                            a.is_empty()
                                                || a.iter()
                                                    .any(|v| v.as_str().is_none_or(str::is_empty))
                                        })
                                })
                        })
                    })
                }) =>
            {
                return Err(invalid("Authentication restrictions need clientSource/serverAddress arrays of addresses or CIDR ranges."));
            }
            _ => {}
        }
        let bson = mongodb::bson::to_bson(value)
            .map_err(|_| invalid("A user or role option cannot be encoded for MongoDB."))?;
        command.insert(if key == "password" { "pwd" } else { key }, bson);
    }
    if action == "create" {
        if !command.contains_key("roles") || (!user && !command.contains_key("privileges")) {
            return Err(invalid("Creation requires explicit roles and, for a role, privileges (empty arrays are allowed)."));
        }
        if user && database != "$external" && !command.contains_key("pwd") {
            return Err(invalid(
                "Choose an environment secret for the new user's password.",
            ));
        }
    }
    if action == "update" && command.len() == 1 {
        return Err(invalid(
            "Choose at least one user or role property to update.",
        ));
    }
    Ok((database.into(), command))
}

pub(super) async fn execute_principal_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let parameters = request
        .parameters
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();
    let (database_name, command) = principal_command(
        &request.operation_id,
        request.object_name.as_deref(),
        &parameters,
    )?;
    let database = mongodb_client(connection).await?.database(&database_name);
    let user = request.operation_id.starts_with("mongodb.user.");
    let name = command
        .values()
        .next()
        .and_then(Bson::as_str)
        .unwrap_or_default();
    if !user && !request.operation_id.ends_with(".create") {
        let info = database
            .run_command(doc! { "rolesInfo": { "role": name, "db": &database_name } })
            .await
            .map_err(|error| {
                let error = principal_error(error);
                if error.code == "mongodb-principal-outcome-unknown" {
                    CommandError::new("mongodb-principal-inspection",
                        "The role could not be inspected. No change was sent; refresh and try again.")
                } else {
                    error
                }
            })?;
        if info.get_array("roles").ok().is_some_and(|roles| {
            roles.iter().any(|r| {
                r.as_document()
                    .is_some_and(|r| r.get_bool("isBuiltin").unwrap_or(false))
            })
        }) {
            return Err(invalid("Built-in MongoDB roles are read-only."));
        }
    }
    // Never return or log the command or server error text: either can contain pwd.
    // No automatic retry: a lost response can leave an uncertain write outcome.
    database
        .run_command(command)
        .await
        .map_err(principal_error)?;
    messages.push("MongoDB confirmed the user/role operation. Refreshing the inventory.".into());
    Ok(OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: Some(json!({ "database": database_name, "acknowledged": true })),
        messages,
        warnings,
    })
}

fn principal_error(error: mongodb::error::Error) -> CommandError {
    if let mongodb::error::ErrorKind::Command(command) = error.kind.as_ref() {
        let hint = match command.code {
            13 => "Permission denied. The connection needs the corresponding MongoDB user/role administration privileges.",
            11 => "That user was not found. Refresh the inventory.",
            31 => "That role was not found. Refresh the inventory.",
            51003 | 51002 => "That user or role already exists. Refresh and edit the existing principal.",
            59 | 115 => "This server does not support native user/role management here. Managed services such as Atlas may require their control plane.",
            _ => "MongoDB rejected the user/role options. Check role names, privileges, authentication restrictions and server compatibility.",
        };
        return CommandError::new(
            "mongodb-principal-command",
            format!("{hint} MongoDB code: {}.", command.code),
        );
    }
    CommandError::new("mongodb-principal-outcome-unknown",
        "The MongoDB user/role operation could not be confirmed. Refresh the inventory and verify its state before retrying; the change may have been applied.")
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/principals_tests.rs"]
mod tests;
