use super::*;
use crate::app::runtime::sqlserver_auth::{self, AuthRequest, AuthStatus};

// No token-bearing response type is registered as a Tauri command.
#[tauri::command]
pub async fn sqlserver_authentication(
    window: tauri::WebviewWindow,
    state: State<'_, SharedAppState>,
    request: AuthRequest,
    operation: String,
) -> Result<AuthStatus, CommandError> {
    if window.label() != "main"
        || !matches!(
            operation.as_str(),
            "status" | "sign-in" | "cancel" | "sign-out"
        )
    {
        return Err(CommandError::new(
            "sqlserver-auth-command",
            "Manage SQL Server sign-in from the main window's connection editor.",
        ));
    }
    let context = {
        let runtime = lock_state(&state)?;
        runtime.ensure_unlocked()?;
        if request.workspace_id != crate::persistence::active_workspace_id(&runtime.app)? {
            return Err(CommandError::new(
                "sqlserver-auth-stale",
                "The workspace changed. Reopen the connection editor before signing in.",
            ));
        }
        if request.workspace_revision != runtime.snapshot.workspace_revision
            && operation != "cancel"
        {
            return Err(CommandError::new(
                "sqlserver-auth-stale",
                "The workspace changed. Reopen the connection editor before signing in.",
            ));
        }
        if request.profile.engine != "sqlserver" {
            return Err(CommandError::new(
                "sqlserver-auth-engine",
                "Select a SQL Server connection.",
            ));
        }
        let connection = crate::domain::models::ResolvedConnectionProfile {
            id: request.profile.id.clone(),
            sqlserver_options: Some(
                request
                    .profile
                    .sqlserver_options
                    .clone()
                    .unwrap_or_default(),
            ),
            ..Default::default()
        };
        runtime.sqlserver_auth_context(&connection, &request.environment_id)?
    };
    if operation == "cancel" {
        sqlserver_auth::cancel(&context);
        return sqlserver_auth::status(None).await;
    }
    if operation == "status" {
        let entra = request
            .profile
            .sqlserver_options
            .as_ref()
            .is_some_and(|options| {
                options.authentication_mode.as_deref() == Some("azure-ad-interactive")
            });
        return sqlserver_auth::status(entra.then_some(&context)).await;
    }
    sqlserver_auth::action(&context, &operation, request.remember).await
}
