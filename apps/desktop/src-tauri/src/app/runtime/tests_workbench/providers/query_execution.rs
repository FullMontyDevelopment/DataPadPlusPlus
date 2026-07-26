use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::watch;

use crate::{
    app::runtime::ManagedAppState,
    domain::{
        error::CommandError,
        models::{ConnectionProfile, ExecutionRequest, ExecutionResponse, ScopedQueryTarget},
    },
};

pub(in crate::app::runtime::tests_workbench) enum ProviderStepExecution {
    Completed(Box<Result<ExecutionResponse, CommandError>>),
    Canceled,
    TimedOut,
}

pub(in crate::app::runtime::tests_workbench) struct DatastoreTestCaseSession {
    provider_id: &'static str,
}

#[async_trait]
pub(in crate::app::runtime::tests_workbench) trait DatastoreTestExecutionProvider:
    Sync
{
    fn id(&self) -> &'static str;
    fn query_language(&self) -> &'static str;
    fn accepted_target_kinds(&self) -> &'static [&'static str];
    fn starter_query(&self, connection: &ConnectionProfile, target: &ScopedQueryTarget) -> String;
    fn supports_step(&self, kind: &str) -> bool;
    fn persistent_case_session(&self) -> bool;
    async fn begin_case_session(
        &self,
        runtime: &mut ManagedAppState,
        connection: &ConnectionProfile,
    ) -> Result<DatastoreTestCaseSession, CommandError>;
    async fn execute_step(
        &self,
        runtime: &mut ManagedAppState,
        session: &DatastoreTestCaseSession,
        request: ExecutionRequest,
        timeout_ms: u64,
        cancelable: bool,
        cancellation: &mut watch::Receiver<bool>,
    ) -> ProviderStepExecution;
    async fn end_case_session(
        &self,
        runtime: &mut ManagedAppState,
        session: DatastoreTestCaseSession,
    ) -> Result<(), CommandError>;

    fn validate_target(&self, target: &ScopedQueryTarget) -> Result<(), CommandError> {
        let kind = normalize_target_kind(&target.kind);
        if target.label.trim().is_empty() {
            return Err(CommandError::new(
                "datastore-test-target-required",
                "Choose a database or datastore object before creating the test suite.",
            ));
        }
        if !self
            .accepted_target_kinds()
            .iter()
            .any(|accepted| normalize_target_kind(accepted) == kind)
        {
            return Err(CommandError::new(
                "datastore-test-target-unsupported",
                format!(
                    "{} is not a supported target for {}.",
                    target.kind,
                    self.id()
                ),
            ));
        }
        Ok(())
    }

    fn query_scope_warnings(
        &self,
        target: &ScopedQueryTarget,
        generated_request: &str,
    ) -> Vec<String> {
        if normalize_target_kind(&target.kind) == "database" {
            return Vec::new();
        }

        let target_is_referenced = generated_request
            .to_ascii_lowercase()
            .contains(&target.label.to_ascii_lowercase());
        vec![if target_is_referenced {
            format!(
                "The raw request references `{}` but cannot be proven not to reference additional datastore objects; review it before execution.",
                target.label
            )
        } else {
            format!(
                "The raw request cannot be proven to stay within the selected target `{}`; review any additional object references.",
                target.label
            )
        }]
    }
}

pub(super) struct QueryExecutionProvider {
    id: &'static str,
    query_language: &'static str,
    accepted_target_kinds: &'static [&'static str],
    starter_query: fn(&ConnectionProfile, &ScopedQueryTarget) -> String,
    persistent_case_session: bool,
}

impl QueryExecutionProvider {
    pub(super) const fn new(
        id: &'static str,
        query_language: &'static str,
        accepted_target_kinds: &'static [&'static str],
        starter_query: fn(&ConnectionProfile, &ScopedQueryTarget) -> String,
        persistent_case_session: bool,
    ) -> Self {
        Self {
            id,
            query_language,
            accepted_target_kinds,
            starter_query,
            persistent_case_session,
        }
    }
}

#[async_trait]
impl DatastoreTestExecutionProvider for QueryExecutionProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn query_language(&self) -> &'static str {
        self.query_language
    }

    fn accepted_target_kinds(&self) -> &'static [&'static str] {
        self.accepted_target_kinds
    }

    fn starter_query(&self, connection: &ConnectionProfile, target: &ScopedQueryTarget) -> String {
        (self.starter_query)(connection, target)
    }

    fn supports_step(&self, kind: &str) -> bool {
        matches!(kind, "query" | "builder")
    }

    fn persistent_case_session(&self) -> bool {
        self.persistent_case_session
    }

    async fn begin_case_session(
        &self,
        _runtime: &mut ManagedAppState,
        _connection: &ConnectionProfile,
    ) -> Result<DatastoreTestCaseSession, CommandError> {
        Ok(DatastoreTestCaseSession {
            provider_id: self.id,
        })
    }

    async fn execute_step(
        &self,
        runtime: &mut ManagedAppState,
        session: &DatastoreTestCaseSession,
        request: ExecutionRequest,
        timeout_ms: u64,
        cancelable: bool,
        cancellation: &mut watch::Receiver<bool>,
    ) -> ProviderStepExecution {
        debug_assert_eq!(session.provider_id, self.id);
        if cancelable && *cancellation.borrow() {
            return ProviderStepExecution::Canceled;
        }
        if !cancelable {
            return match tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                runtime.execute_query(request),
            )
            .await
            {
                Ok(response) => ProviderStepExecution::Completed(Box::new(response)),
                Err(_) => ProviderStepExecution::TimedOut,
            };
        }

        tokio::select! {
            response = tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                runtime.execute_query(request),
            ) => match response {
                Ok(response) => ProviderStepExecution::Completed(Box::new(response)),
                Err(_) => ProviderStepExecution::TimedOut,
            },
            _ = cancellation.changed() => ProviderStepExecution::Canceled,
        }
    }

    async fn end_case_session(
        &self,
        _runtime: &mut ManagedAppState,
        session: DatastoreTestCaseSession,
    ) -> Result<(), CommandError> {
        debug_assert_eq!(session.provider_id, self.id);
        Ok(())
    }
}

fn normalize_target_kind(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

pub(super) fn sql_starter_query(
    _connection: &ConnectionProfile,
    target: &ScopedQueryTarget,
) -> String {
    if normalize_target_kind(&target.kind) == "database" {
        return "select 1;".into();
    }

    let mut parts = target.path.clone();
    if parts.last().is_none_or(|part| part != &target.label) {
        parts.push(target.label.clone());
    }
    let qualified = parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(".");
    format!("select * from {qualified} limit 1;")
}
