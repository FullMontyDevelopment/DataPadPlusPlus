use serde_json::json;

use super::super::super::*;
use super::connection::{duckdb_error, open_duckdb_connection};
use super::query_results::query_table;

pub(super) async fn collect_duckdb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let db = open_duckdb_connection(connection)?;
    let version: String = db
        .query_row("select version()", [], |row| row.get(0))
        .map_err(duckdb_error)?;
    let (_columns, tables) = query_table(
        &db,
        "select table_name from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')",
        5_000,
    )?;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "duckdb.api.reachable",
            "value": 1,
            "unit": "flag",
            "labels": { "source": "embedded" }
        },
        {
            "name": "duckdb.tables.count",
            "value": tables.len(),
            "unit": "tables",
            "labels": { "source": "information_schema.tables" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "duckdb",
        "version": version,
        "templates": [
            "select * from read_csv_auto('file.csv') limit 100",
            "select * from read_parquet('file.parquet') limit 100",
            "explain select * from table limit 100",
            "explain analyze select * from table limit 100"
        ],
    })));
    diagnostics.warnings.push(
        "DuckDB can scan large local CSV/Parquet files quickly; keep row limits and EXPLAIN plans visible before dashboarding file-backed queries."
            .into(),
    );
    Ok(diagnostics)
}
