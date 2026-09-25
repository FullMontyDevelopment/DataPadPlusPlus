use super::*;
use datapadplusplus_desktop_lib::domain::models::ExplorerInspectRequest;
use mongodb::bson::doc;

pub(super) async fn validate_principals(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
) -> Result<(), CommandError> {
    let suffix = mongodb::bson::oid::ObjectId::new().to_hex();
    let user = format!("datapad_fixture_user_{suffix}");
    let role = format!("datapad_fixture_role_{suffix}");
    let password = format!("fixture-only-{suffix}");
    let verify = |condition: bool, message: &str| {
        if condition {
            Ok(())
        } else {
            Err(CommandError::new("fixture-assertion", message))
        }
    };
    let request = |id: &str, name: &str, options: serde_json::Value| {
        let mut parameters: HashMap<String, serde_json::Value> =
            options.as_object().unwrap().clone().into_iter().collect();
        parameters.insert("database".into(), json!("admin"));
        parameters.insert("name".into(), json!(name));
        OperationExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-fixture".into(),
            operation_id: id.into(),
            object_name: Some(name.into()),
            parameters: Some(parameters),
            confirmation_text: Some("CONFIRM MONGODB".into()),
            row_limit: None,
            tab_id: None,
        }
    };
    let inspect = |node: String| ExplorerInspectRequest {
        connection_id: connection.id.clone(),
        environment_id: "env-fixture".into(),
        node_id: node,
    };
    let result: Result<(), CommandError> = async {
        let create_role = request("mongodb.role.create", &role, json!({
            "roles": [], "privileges": [{ "resource": { "db": "datapad_fixture", "collection": "" }, "actions": ["find"] }]
        }));
        let mut readonly = connection.clone();
        readonly.read_only = true;
        verify(!adapters::execute_operation(&readonly, &create_role).await?.executed, "Read-only creation must be blocked")?;
        let mut unconfirmed = create_role.clone();
        unconfirmed.confirmation_text = None;
        verify(!adapters::execute_operation(connection, &unconfirmed).await?.executed, "Unconfirmed creation must be blocked")?;
        verify(adapters::execute_operation(connection, &create_role).await?.executed, "Role creation was not acknowledged")?;
        let created = adapters::execute_operation(connection, &request("mongodb.user.create", &user, json!({
            "password": password, "roles": [{ "role": role, "db": "admin" }]
        }))).await?;
        verify(created.executed, "User creation was not acknowledged")?;
        verify(!serde_json::to_string(&created).unwrap().contains(&password), "Password leaked in operation response")?;
        let users = adapters::inspect_explorer_node(connection, &inspect("admin:users".into())).await?;
        verify(users.payload.as_ref().and_then(|p| p["users"].as_array())
            .is_some_and(|items| items.iter().any(|item| item["user"] == user)), "Legacy admin Users view did not list the user")?;
        let role_info = adapters::inspect_explorer_node(connection, &inspect(format!("role:admin:{role}"))).await?;
        verify(role_info.payload.as_ref().and_then(|p| p["roles"].as_array())
            .is_some_and(|items| !items.is_empty()), "Single-role inspection returned no metadata")?;
        verify(adapters::execute_operation(connection, &request("mongodb.user.update", &user, json!({
            "roles": [{ "role": "read", "db": "datapad_fixture" }], "customData": { "fixture": true }
        }))).await?.executed, "User update was not acknowledged")?;
        let info = adapters::inspect_explorer_node(connection, &inspect(format!("user:admin:{user}"))).await?;
        verify(info.payload.as_ref().is_some_and(|p| p["users"][0]["roles"][0]["role"] == "read"), "User update was not reflected in inspection")?;
        let mut login = connection.clone();
        login.username = Some(user.clone());
        login.password = Some(password.clone());
        login.connection_string = None;
        login.database = Some("admin".into());
        verify(adapters::test_connection(&login, vec![]).await?.ok, "Role-only updates must preserve the password")?;
        verify(adapters::execute_operation(connection, &request("mongodb.role.update", &role, json!({
            "roles": [], "privileges": []
        }))).await?.executed, "Role update was not acknowledged")?;
        verify(adapters::execute_operation(connection, &request("mongodb.role.drop", "root", json!({}))).await.is_err(),
            "Built-in role removal must be rejected")?;
        verify(adapters::execute_operation(connection, &request("mongodb.user.drop", &user, json!({}))).await?.executed, "User removal was not acknowledged")?;
        verify(adapters::execute_operation(connection, &request("mongodb.role.drop", &role, json!({}))).await?.executed, "Role removal was not acknowledged")?;
        let remaining = adapters::inspect_explorer_node(connection, &inspect("users:admin".into())).await?;
        verify(!remaining.payload.as_ref().and_then(|p| p["users"].as_array())
            .is_some_and(|items| items.iter().any(|item| item["user"] == user)), "Deleted user remains in inventory")?;
        Ok(())
    }.await;
    // Only these uniquely named fixture principals may be removed, including after errors.
    let admin = client.database("admin");
    let cleanup_user = admin.run_command(doc! { "dropUser": &user }).await;
    let cleanup_role = admin.run_command(doc! { "dropRole": &role }).await;
    result?;
    for cleanup in [cleanup_user, cleanup_role] {
        if let Err(error) = cleanup {
            verify(
                matches!(error.kind.as_ref(), mongodb::error::ErrorKind::Command(command)
                if command.code == 11 || command.code == 31),
                "Unable to verify fixture principal cleanup",
            )?;
        }
    }
    Ok(())
}
