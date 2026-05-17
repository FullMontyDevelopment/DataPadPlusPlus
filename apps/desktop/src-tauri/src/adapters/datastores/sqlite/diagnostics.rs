use serde_json::json;

use super::super::super::*;
use super::connection::sqlite_pool;
use super::SqliteAdapter;

pub(super) async fn collect_sqlite_diagnostics(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = SqliteAdapter.manifest();
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let pool = sqlite_pool(connection).await?;
    let page_count: i64 = sqlx::query_scalar("pragma page_count")
        .fetch_one(&pool)
        .await?;
    let page_size: i64 = sqlx::query_scalar("pragma page_size")
        .fetch_one(&pool)
        .await?;
    let freelist_count: i64 = sqlx::query_scalar("pragma freelist_count")
        .fetch_one(&pool)
        .await?;
    let table_count: i64 = sqlx::query_scalar(
        "select count(*) from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    )
    .fetch_one(&pool)
    .await?;
    let index_count: i64 = sqlx::query_scalar(
        "select count(*) from sqlite_master where type = 'index' and name not like 'sqlite_%'",
    )
    .fetch_one(&pool)
    .await?;
    let view_count: i64 = sqlx::query_scalar(
        "select count(*) from sqlite_master where type = 'view' and name not like 'sqlite_%'",
    )
    .fetch_one(&pool)
    .await?;
    pool.close().await;

    let metrics = vec![
        metric(
            "sqlite.database_size",
            (page_count * page_size) as f64,
            "bytes",
            json!({ "source": "PRAGMA page_count/page_size" }),
        ),
        metric(
            "sqlite.free_pages",
            freelist_count as f64,
            "pages",
            json!({ "source": "PRAGMA freelist_count" }),
        ),
        metric(
            "sqlite.tables",
            table_count as f64,
            "tables",
            json!({ "source": "sqlite_master" }),
        ),
        metric(
            "sqlite.indexes",
            index_count as f64,
            "indexes",
            json!({ "source": "sqlite_master" }),
        ),
        metric(
            "sqlite.views",
            view_count as f64,
            "views",
            json!({ "source": "sqlite_master" }),
        ),
    ];
    let timestamp = crate::app::runtime::timestamp_now();
    diagnostics.metrics.push(payload_metrics(json!(metrics)));
    diagnostics
        .metrics
        .push(payload_metric_series(&metrics, &timestamp));
    diagnostics
        .metrics
        .push(payload_metric_bar_chart(&metrics, "SQLite file health"));

    Ok(diagnostics)
}
