use super::{
    query_execution::sql_starter_query, DatastoreTestExecutionProvider, QueryExecutionProvider,
};

static PROVIDER: QueryExecutionProvider = QueryExecutionProvider::new(
    "postgresql-test-execution",
    "sql",
    &[
        "database",
        "table",
        "base-table",
        "view",
        "materialized-view",
    ],
    sql_starter_query,
    false,
);

pub(super) fn provider() -> &'static dyn DatastoreTestExecutionProvider {
    &PROVIDER
}
