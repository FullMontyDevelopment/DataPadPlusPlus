mod dynamodb;
mod mongodb;
mod postgresql;
mod query_execution;
mod redis;
mod sqlite;
mod valkey;

use query_execution::QueryExecutionProvider;
pub(super) use query_execution::{
    DatastoreTestCaseSession, DatastoreTestExecutionProvider, ProviderStepExecution,
};

use crate::domain::models::ConnectionProfile;

pub(super) fn provider_for_connection(
    connection: &ConnectionProfile,
) -> Option<&'static dyn DatastoreTestExecutionProvider> {
    match connection.engine.as_str() {
        "postgresql" => Some(postgresql::provider()),
        "sqlite" => Some(sqlite::provider()),
        "mongodb" => Some(mongodb::provider()),
        "redis" => Some(redis::provider()),
        "valkey" => Some(valkey::provider()),
        "dynamodb" => Some(dynamodb::provider()),
        _ => None,
    }
}

#[cfg(test)]
pub(super) fn registered_provider_ids() -> Vec<&'static str> {
    [
        postgresql::provider(),
        sqlite::provider(),
        mongodb::provider(),
        redis::provider(),
        valkey::provider(),
        dynamodb::provider(),
    ]
    .into_iter()
    .map(DatastoreTestExecutionProvider::id)
    .collect()
}
