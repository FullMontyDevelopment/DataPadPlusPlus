use super::*;

mod document;
mod keyvalue;
mod search;
mod sql;
mod widecolumn;

trait ApiServerDatastoreProvider: Sync {
    fn engines(&self) -> &'static [&'static str];
    fn resource_kinds(&self) -> &'static [&'static str];
    fn language(&self) -> &'static str;
    fn schema_hint(&self) -> &'static str;
    fn read_query(
        &self,
        engine: &str,
        resource: &ResourceRouteTarget,
        limit: u32,
        identity: Option<&Value>,
    ) -> Option<Result<String, ApiRouteError>>;
    fn edit_kind(&self, kind: &str, method: &str) -> Option<&'static str>;
}

struct Provider {
    engines: &'static [&'static str],
    resource_kinds: &'static [&'static str],
    language: &'static str,
    schema_hint: &'static str,
    read_query: Option<ReadQueryProvider>,
    edit_kind: Option<EditKindProvider>,
}

type ReadQueryProvider = fn(
    &str,
    &ResourceRouteTarget,
    u32,
    Option<&Value>,
) -> Result<String, ApiRouteError>;
type EditKindProvider = fn(&str, &str) -> Option<&'static str>;

impl ApiServerDatastoreProvider for Provider {
    fn engines(&self) -> &'static [&'static str] { self.engines }
    fn resource_kinds(&self) -> &'static [&'static str] { self.resource_kinds }
    fn language(&self) -> &'static str { self.language }
    fn schema_hint(&self) -> &'static str { self.schema_hint }

    fn read_query(
        &self,
        engine: &str,
        resource: &ResourceRouteTarget,
        limit: u32,
        identity: Option<&Value>,
    ) -> Option<Result<String, ApiRouteError>> {
        self.read_query.map(|provider| provider(engine, resource, limit, identity))
    }

    fn edit_kind(&self, kind: &str, method: &str) -> Option<&'static str> {
        self.edit_kind.and_then(|provider| provider(kind, method))
    }
}

static PROVIDERS: &[Provider] = &[
    Provider { engines: &["postgresql", "cockroachdb", "sqlserver", "mysql", "mariadb", "sqlite", "timescaledb", "oracle"], resource_kinds: &["table"], language: "sql", schema_hint: "relational", read_query: Some(sql::read_query), edit_kind: Some(sql::edit_kind) },
    Provider { engines: &["duckdb"], resource_kinds: &["table"], language: "duckdb-sql", schema_hint: "relational", read_query: Some(sql::read_query), edit_kind: Some(sql::edit_kind) },
    Provider { engines: &["snowflake"], resource_kinds: &["table"], language: "snowflake-sql", schema_hint: "warehouse", read_query: Some(sql::read_query), edit_kind: Some(sql::edit_kind) },
    Provider { engines: &["bigquery"], resource_kinds: &["table"], language: "google-sql", schema_hint: "warehouse", read_query: Some(sql::read_query), edit_kind: Some(sql::edit_kind) },
    Provider { engines: &["clickhouse"], resource_kinds: &["table"], language: "clickhouse-sql", schema_hint: "warehouse", read_query: Some(sql::read_query), edit_kind: Some(sql::edit_kind) },
    Provider { engines: &["mongodb", "litedb"], resource_kinds: &["collection"], language: "mongodb", schema_hint: "document", read_query: Some(document::read_query), edit_kind: Some(document::edit_kind) },
    Provider { engines: &["redis", "valkey"], resource_kinds: &["key"], language: "redis", schema_hint: "keyvalue", read_query: Some(keyvalue::read_query), edit_kind: Some(keyvalue::edit_kind) },
    Provider { engines: &["dynamodb"], resource_kinds: &["item"], language: "json", schema_hint: "widecolumn", read_query: Some(widecolumn::read_query), edit_kind: Some(widecolumn::edit_kind) },
    Provider { engines: &["elasticsearch", "opensearch"], resource_kinds: &["index"], language: "query-dsl", schema_hint: "search", read_query: Some(search::read_query), edit_kind: Some(search::edit_kind) },
    Provider { engines: &["cassandra"], resource_kinds: &[], language: "cql", schema_hint: "widecolumn", read_query: None, edit_kind: None },
    Provider { engines: &["cosmosdb", "memcached", "neo4j", "neptune", "arango", "janusgraph", "influxdb", "prometheus", "opentsdb"], resource_kinds: &[], language: "text", schema_hint: "unstructured", read_query: None, edit_kind: None },
];

fn provider_for(engine: &str) -> Option<&'static dyn ApiServerDatastoreProvider> {
    PROVIDERS.iter().find(|provider| provider.engines().contains(&engine))
        .map(|provider| provider as &dyn ApiServerDatastoreProvider)
}

pub(super) fn resource_kinds_for(engine: &str) -> Vec<&'static str> {
    provider_for(engine).map(|provider| provider.resource_kinds().to_vec()).unwrap_or_default()
}

pub(super) fn read_query_for_provider(engine: &str, resource: &ResourceRouteTarget, limit: u32, identity: Option<&Value>) -> Option<Result<String, ApiRouteError>> {
    provider_for(engine)?.read_query(engine, resource, limit, identity)
}

pub(super) fn edit_kind_for_provider(engine: &str, kind: &str, method: &str) -> Option<&'static str> {
    provider_for(engine)?.edit_kind(kind, method)
}

pub(super) fn language_for_provider(engine: &str) -> String {
    provider_for(engine).map(ApiServerDatastoreProvider::language).unwrap_or("text").into()
}

#[allow(dead_code)]
pub(super) fn schema_hint_for_provider(engine: &str) -> &'static str {
    provider_for(engine).map(ApiServerDatastoreProvider::schema_hint).unwrap_or("unstructured")
}

#[cfg(test)]
pub(super) fn provider_registration_count(engine: &str) -> usize {
    PROVIDERS
        .iter()
        .filter(|provider| provider.engines().contains(&engine))
        .count()
}
