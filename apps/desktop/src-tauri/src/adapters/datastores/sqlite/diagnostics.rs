use serde_json::json;
use sqlx::Row;

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
    let foreign_keys: i64 = sqlx::query_scalar("pragma foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    let user_version: i64 = sqlx::query_scalar("pragma user_version")
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    let application_id: i64 = sqlx::query_scalar("pragma application_id")
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    let quick_check = sqlx::query_scalar::<_, String>("pragma quick_check")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| "unavailable".into());
    let journal_mode = sqlx::query_scalar::<_, String>("pragma journal_mode")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| "unknown".into());
    let synchronous: i64 = sqlx::query_scalar("pragma synchronous")
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    let attached = sqlx::query("pragma database_list")
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "seq": row.try_get::<i64, _>("seq").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "file": row.try_get::<String, _>("file").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
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
        metric(
            "sqlite.foreign_keys_enabled",
            foreign_keys as f64,
            "boolean",
            json!({ "source": "PRAGMA foreign_keys" }),
        ),
        metric(
            "sqlite.user_version",
            user_version as f64,
            "version",
            json!({ "source": "PRAGMA user_version" }),
        ),
        metric(
            "sqlite.application_id",
            application_id as f64,
            "id",
            json!({ "source": "PRAGMA application_id" }),
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
    diagnostics.metrics.push(payload_table(
        vec!["setting".into(), "value".into(), "source".into()],
        vec![
            vec![
                "journal_mode".into(),
                journal_mode,
                "PRAGMA journal_mode".into(),
            ],
            vec![
                "synchronous".into(),
                synchronous.to_string(),
                "PRAGMA synchronous".into(),
            ],
            vec![
                "foreign_keys".into(),
                foreign_keys.to_string(),
                "PRAGMA foreign_keys".into(),
            ],
            vec![
                "quick_check".into(),
                quick_check,
                "PRAGMA quick_check".into(),
            ],
        ],
    ));
    diagnostics.metrics.push(payload_json(json!({
        "engine": "sqlite",
        "attachedDatabases": attached,
        "maintenance": {
            "quickCheck": "Use PRAGMA quick_check for fast checks and PRAGMA integrity_check for full checks.",
            "vacuum": "VACUUM and VACUUM INTO are guarded maintenance operations.",
            "optimize": "PRAGMA optimize is available as a low-impact planner statistics refresh."
        }
    })));

    Ok(diagnostics)
}
