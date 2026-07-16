use crate::domain::models::{CosmosDbConnectionOptions, QueryTabState, WorkspaceSnapshot};

const CASSANDRA_FIXTURE_CONNECTION_ID: &str = "fixture-cassandra";
const LEGACY_CASSANDRA_FIXTURE_QUERY: &str = "select * from datapadplusplus.orders limit 25;";
pub(super) const CASSANDRA_FIXTURE_QUERY: &str = "select account_id, order_id, status, total_amount, updated_at from datapadplusplus.orders_by_account where account_id = 1 limit 25;";
const DYNAMODB_FIXTURE_CONNECTION_ID: &str = "fixture-dynamodb";
const LEGACY_DYNAMODB_FIXTURE_QUERY: &str = "{\n  \"table\": \"orders\",\n  \"limit\": 25\n}";
pub(super) const DYNAMODB_FIXTURE_QUERY: &str =
    "{\n  \"operation\": \"Scan\",\n  \"tableName\": \"orders\",\n  \"limit\": 25\n}";
const PROMETHEUS_FIXTURE_CONNECTION_ID: &str = "fixture-prometheus";
const LEGACY_PROMETHEUS_FIXTURE_QUERY: &str = "up";
pub(super) const PROMETHEUS_FIXTURE_QUERY: &str =
    r#"{__name__=~"prometheus_tsdb_head_(series|chunks|samples_appended_total)"}[15m]"#;
const COSMOSDB_FIXTURE_CONNECTION_ID: &str = "fixture-cosmosdb";
const COSMOSDB_FIXTURE_DEFAULT_CONTAINER: &str = "orders";

pub(super) fn migrate_fixture_workspace(snapshot: &mut WorkspaceSnapshot) {
    migrate_cosmosdb_fixture_connection(snapshot);
    for tab in &mut snapshot.tabs {
        migrate_fixture_tab(tab);
    }
    for closed_tab in &mut snapshot.closed_tabs {
        migrate_fixture_tab(&mut closed_tab.tab);
    }
    for node in &mut snapshot.library_nodes {
        if let Some(query) = node.query_text.as_deref().and_then(|query| {
            fixture_query_replacement(node.connection_id.as_deref().unwrap_or_default(), query)
        }) {
            node.query_text = Some(query.into());
        }
    }
    for item in &mut snapshot.saved_work {
        if let Some(query) = item.query_text.as_deref().and_then(|query| {
            fixture_query_replacement(item.connection_id.as_deref().unwrap_or_default(), query)
        }) {
            item.query_text = Some(query.into());
        }
    }
}

fn migrate_cosmosdb_fixture_connection(snapshot: &mut WorkspaceSnapshot) {
    let Some(connection) = snapshot
        .connections
        .iter_mut()
        .find(|connection| connection.id == COSMOSDB_FIXTURE_CONNECTION_ID)
    else {
        return;
    };
    let options = connection
        .cosmos_db_options
        .get_or_insert_with(CosmosDbConnectionOptions::default);
    if options.api.as_deref().is_none_or(str::is_empty) {
        options.api = Some("nosql".into());
    }
    if options.database_name.as_deref().is_none_or(str::is_empty) {
        options.database_name = connection.database.clone();
    }
    if options
        .container_prefix
        .as_deref()
        .is_none_or(str::is_empty)
    {
        options.container_prefix = Some(COSMOSDB_FIXTURE_DEFAULT_CONTAINER.into());
    }
}

fn migrate_fixture_tab(tab: &mut QueryTabState) {
    if let Some(query) = fixture_query_replacement(&tab.connection_id, &tab.query_text) {
        tab.query_text = query.into();
    }
    for history in &mut tab.history {
        if history.status == "seeded" {
            if let Some(query) = fixture_query_replacement(&tab.connection_id, &history.query_text)
            {
                history.query_text = query.into();
            }
        }
    }
}

fn fixture_query_replacement(connection_id: &str, query: &str) -> Option<&'static str> {
    match (connection_id, query) {
        (CASSANDRA_FIXTURE_CONNECTION_ID, LEGACY_CASSANDRA_FIXTURE_QUERY) => {
            Some(CASSANDRA_FIXTURE_QUERY)
        }
        (DYNAMODB_FIXTURE_CONNECTION_ID, LEGACY_DYNAMODB_FIXTURE_QUERY) => {
            Some(DYNAMODB_FIXTURE_QUERY)
        }
        (PROMETHEUS_FIXTURE_CONNECTION_ID, LEGACY_PROMETHEUS_FIXTURE_QUERY) => {
            Some(PROMETHEUS_FIXTURE_QUERY)
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/workspace_fixture_migrations_tests.rs"]
mod tests;
