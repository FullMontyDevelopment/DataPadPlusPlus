use super::super::super::*;
use super::connection::{oracle_service_name, oracle_sqlplus_path};
use super::query::{oracle_sqlplus_script, parse_oracle_sqlplus_csv, run_oracle_sqlplus_script};
use super::sidecar::{execute_oracle_managed_read, oracle_execution_runtime};

pub(super) const ORACLE_SESSION_CONTEXT_QUERY: &str =
    "select sys_context('USERENV', 'SESSION_USER'), sys_context('USERENV', 'CURRENT_SCHEMA'), sys_context('USERENV', 'PROXY_USER'), sys_context('USERENV', 'DB_NAME'), sys_context('USERENV', 'DB_UNIQUE_NAME'), sys_context('USERENV', 'CON_NAME'), sys_context('USERENV', 'CON_ID'), sys_context('USERENV', 'SERVICE_NAME') from dual";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct OracleSessionContext {
    pub session_user: String,
    pub current_schema: String,
    pub proxy_user: Option<String>,
    pub database_name: String,
    pub database_unique_name: String,
    pub container_name: String,
    pub container_id: Option<u32>,
    pub service_name: String,
}

impl OracleSessionContext {
    pub fn from_test_response(
        connection: &ResolvedConnectionProfile,
        response: &Value,
    ) -> Result<Self, CommandError> {
        let session_user = response_string(response, "sessionUser")
            .or_else(|| response_string(response, "authenticatedSchema"))
            .ok_or_else(invalid_session_context_response)?;
        let current_schema =
            response_string(response, "currentSchema").unwrap_or_else(|| session_user.clone());
        let database_name = response_string(response, "databaseName")
            .or_else(|| connection.database.clone())
            .unwrap_or_else(|| oracle_service_name(connection));
        let database_unique_name = response_string(response, "databaseUniqueName")
            .unwrap_or_else(|| database_name.clone());
        let service_name = response_string(response, "serviceName")
            .unwrap_or_else(|| oracle_service_name(connection));
        let container_name =
            response_string(response, "containerName").unwrap_or_else(|| database_name.clone());

        Ok(Self {
            session_user,
            current_schema,
            proxy_user: response_string(response, "proxyUser"),
            database_name,
            database_unique_name,
            container_name,
            container_id: response
                .get("containerId")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok()),
            service_name,
        })
    }

    fn from_row(
        connection: &ResolvedConnectionProfile,
        row: &[String],
    ) -> Result<Self, CommandError> {
        let session_user = required_row_value(row, 0)?;
        let current_schema = required_row_value(row, 1)?;
        let database_name = required_row_value(row, 3)?;
        let database_unique_name =
            optional_row_value(row, 4).unwrap_or_else(|| database_name.clone());
        let container_name = optional_row_value(row, 5).unwrap_or_else(|| database_name.clone());
        let service_name =
            optional_row_value(row, 7).unwrap_or_else(|| oracle_service_name(connection));

        Ok(Self {
            session_user,
            current_schema,
            proxy_user: optional_row_value(row, 2),
            database_name,
            database_unique_name,
            container_name,
            container_id: optional_row_value(row, 6).and_then(|value| value.parse().ok()),
            service_name,
        })
    }

    pub fn contract(connection: &ResolvedConnectionProfile) -> Self {
        let schema = connection
            .username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("APP")
            .to_string();
        let service = oracle_service_name(connection);
        let database = connection
            .database
            .clone()
            .unwrap_or_else(|| service.clone());

        Self {
            session_user: schema.clone(),
            current_schema: schema,
            proxy_user: None,
            database_name: database.clone(),
            database_unique_name: database,
            container_name: service.clone(),
            container_id: None,
            service_name: service,
        }
    }

    pub fn database_label(&self) -> &str {
        if self.container_name.trim().is_empty() {
            &self.database_name
        } else {
            &self.container_name
        }
    }

    pub fn detail(&self) -> String {
        let mut details = vec![format!("Service {}", self.service_name)];
        if self.database_name != self.database_label() {
            details.push(format!("Database {}", self.database_name));
        }
        if self.database_unique_name != self.database_name {
            details.push(format!("Unique name {}", self.database_unique_name));
        }
        details.push(format!("Current schema {}", self.current_schema));
        if let Some(proxy_user) = self.proxy_user.as_deref() {
            details.push(format!("Proxy user {proxy_user}"));
        }
        format!("Connected Oracle container. {}.", details.join(" / "))
    }
}

pub(super) async fn load_oracle_session_context(
    connection: &ResolvedConnectionProfile,
) -> Result<OracleSessionContext, CommandError> {
    match oracle_execution_runtime(connection) {
        "managed" => {
            let response =
                execute_oracle_managed_read(connection, ORACLE_SESSION_CONTEXT_QUERY, 1).await?;
            let rows = oracle_managed_response_rows(&response)?;
            OracleSessionContext::from_row(
                connection,
                rows.first().ok_or_else(invalid_session_context_response)?,
            )
        }
        "sqlplus" => {
            let path = oracle_sqlplus_path(connection).unwrap_or_else(|| "sqlplus".into());
            let script = oracle_sqlplus_script(connection, ORACLE_SESSION_CONTEXT_QUERY, 1, false)?;
            let output = run_oracle_sqlplus_script(connection, &path, &script).await?;
            let (_, rows) = parse_oracle_sqlplus_csv(&output, 1)?;
            OracleSessionContext::from_row(
                connection,
                rows.first().ok_or_else(invalid_session_context_response)?,
            )
        }
        "contract" => Ok(OracleSessionContext::contract(connection)),
        unsupported => Err(CommandError::new(
            "oracle-runtime-unsupported",
            format!("Oracle execution runtime '{unsupported}' is not supported."),
        )),
    }
}

pub(super) fn oracle_managed_response_rows(
    response: &Value,
) -> Result<Vec<Vec<String>>, CommandError> {
    let rows = response
        .get("sections")
        .and_then(Value::as_array)
        .and_then(|sections| sections.first())
        .and_then(|section| section.get("rows"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommandError::new(
                "oracle-metadata-response-invalid",
                "The Oracle runtime returned an invalid metadata response.",
            )
        })?;

    Ok(rows
        .iter()
        .filter_map(Value::as_array)
        .map(|row| {
            row.iter()
                .map(|value| match value {
                    Value::Null => String::new(),
                    Value::String(value) => value.clone(),
                    other => other.to_string(),
                })
                .collect()
        })
        .collect())
}

fn response_string(response: &Value, field: &str) -> Option<String> {
    response
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn required_row_value(row: &[String], index: usize) -> Result<String, CommandError> {
    optional_row_value(row, index).ok_or_else(invalid_session_context_response)
}

fn optional_row_value(row: &[String], index: usize) -> Option<String> {
    row.get(index)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn invalid_session_context_response() -> CommandError {
    CommandError::new(
        "oracle-session-context-invalid",
        "Oracle returned incomplete session identity metadata.",
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/session_tests.rs"]
mod tests;
