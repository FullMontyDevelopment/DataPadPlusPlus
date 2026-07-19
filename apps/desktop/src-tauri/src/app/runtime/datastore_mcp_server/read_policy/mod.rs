use super::*;

mod json;
mod keyvalue;
mod mongodb;
mod sql;

trait McpReadPolicy: Sync {
    fn languages(&self) -> &'static [&'static str];
    fn validate(&self, query: &str) -> Result<(), McpError>;
}

struct Policy {
    languages: &'static [&'static str],
    validate: fn(&str) -> Result<(), McpError>,
}

impl McpReadPolicy for Policy {
    fn languages(&self) -> &'static [&'static str] {
        self.languages
    }

    fn validate(&self, query: &str) -> Result<(), McpError> {
        (self.validate)(query)
    }
}

static MONGODB_POLICY: Policy = Policy {
    languages: &["mongo", "mongodb"],
    validate: mongodb::validate,
};
static KEYVALUE_POLICY: Policy = Policy {
    languages: &["redis", "valkey"],
    validate: keyvalue::validate,
};
static JSON_POLICY: Policy = Policy {
    languages: &["json", "query-dsl", "dynamodb"],
    validate: json::validate,
};
static SQL_POLICY: Policy = Policy {
    languages: &[
        "sql",
        "cql",
        "snowflake-sql",
        "google-sql",
        "clickhouse-sql",
        "duckdb-sql",
    ],
    validate: sql::validate,
};
static READ_POLICIES: [&dyn McpReadPolicy; 4] = [
    &MONGODB_POLICY,
    &KEYVALUE_POLICY,
    &JSON_POLICY,
    &SQL_POLICY,
];

const ENGINE_LANGUAGES: &[(&[&str], &str)] = &[
    (&["mongodb"], "mongodb"),
    (&["redis", "valkey"], "redis"),
    (&["elasticsearch", "opensearch"], "query-dsl"),
    (&["dynamodb"], "json"),
    (&["cassandra"], "cql"),
    (&["snowflake"], "snowflake-sql"),
    (&["bigquery"], "google-sql"),
    (&["clickhouse"], "clickhouse-sql"),
    (&["duckdb"], "duckdb-sql"),
];
const SQL_FAMILIES: &[&str] = &["sql", "warehouse", "embedded-olap"];

pub(super) fn validate(query: &str, language: Option<&str>) -> Result<(), McpError> {
    let language = language.unwrap_or_default().to_ascii_lowercase();
    let policy = if query.starts_with('{') || query.starts_with('[') {
        &JSON_POLICY as &dyn McpReadPolicy
    } else {
        READ_POLICIES
            .iter()
            .copied()
            .find(|policy| {
                policy
                    .languages()
                    .iter()
                    .any(|candidate| language.contains(candidate))
            })
            .unwrap_or(&SQL_POLICY)
    };
    policy.validate(query)
}

pub(super) fn language_for_connection(connection: &ConnectionProfile) -> String {
    ENGINE_LANGUAGES
        .iter()
        .find(|(engines, _)| engines.contains(&connection.engine.as_str()))
        .map(|(_, language)| *language)
        .or_else(|| {
            SQL_FAMILIES
                .contains(&connection.family.as_str())
                .then_some("sql")
        })
        .unwrap_or("text")
        .into()
}

pub(super) fn has_multiple_statements(query: &str) -> bool {
    sql::has_multiple_statements(query)
}

#[cfg(test)]
pub(super) fn matching_policy_count(language: &str) -> usize {
    let language = language.to_ascii_lowercase();
    READ_POLICIES
        .iter()
        .filter(|policy| policy.languages().iter().any(|candidate| language.contains(candidate)))
        .count()
}
