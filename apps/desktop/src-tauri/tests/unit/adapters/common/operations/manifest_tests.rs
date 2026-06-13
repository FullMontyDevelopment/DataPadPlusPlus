use super::operation_manifests_for_manifest;
use crate::domain::models::AdapterManifest;

#[test]
fn mongodb_operation_manifest_exposes_native_management_previews() {
    let manifest = AdapterManifest {
        id: "adapter-mongodb".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        label: "MongoDB".into(),
        maturity: "stable".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_user_role_browser".into(),
            "supports_import_export".into(),
        ],
        default_language: "mongodb".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"mongodb.index.hide"));
    assert!(operation_ids.contains(&"mongodb.validation.update"));
    assert!(operation_ids.contains(&"mongodb.database.create"));
    assert!(operation_ids.contains(&"mongodb.database.drop"));
    assert!(operation_ids.contains(&"mongodb.collection.create"));
    assert!(operation_ids.contains(&"mongodb.collection.drop"));
    assert!(operation_ids.contains(&"mongodb.collection.rename"));
    assert!(operation_ids.contains(&"mongodb.collection.modify"));
    assert!(operation_ids.contains(&"mongodb.collection.convert-to-capped"));
    assert!(operation_ids.contains(&"mongodb.collection.clone-as-capped"));
    assert!(operation_ids.contains(&"mongodb.collection.compact"));
    assert!(operation_ids.contains(&"mongodb.collection.validate"));
    assert!(operation_ids.contains(&"mongodb.user.create"));
    assert!(operation_ids.contains(&"mongodb.user.drop"));
    assert!(operation_ids.contains(&"mongodb.role.create"));
    assert!(operation_ids.contains(&"mongodb.role.drop"));
    assert!(operation_ids.contains(&"mongodb.collection.export"));
    assert!(operation_ids.contains(&"mongodb.collection.import"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "mongodb.user.drop")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "mongodb.collection.validate")
            .map(|operation| operation.risk.as_str()),
        Some("costly")
    );
    for operation_id in [
        "mongodb.database.create",
        "mongodb.database.drop",
        "mongodb.collection.create",
        "mongodb.collection.drop",
        "mongodb.collection.rename",
        "mongodb.collection.modify",
        "mongodb.collection.convert-to-capped",
        "mongodb.collection.clone-as-capped",
        "mongodb.collection.compact",
        "mongodb.collection.validate",
        "mongodb.collection.export",
        "mongodb.collection.import",
    ] {
        let operation = operations
            .iter()
            .find(|operation| operation.id == operation_id)
            .expect("MongoDB collection file operation");
        assert_eq!(operation.execution_support, "live");
        assert!(operation.disabled_reason.is_none());
        assert!(operation.requires_confirmation);
    }
}

#[test]
fn redis_like_operation_manifest_exposes_key_management_previews() {
    for engine in ["redis", "valkey"] {
        let manifest = AdapterManifest {
            id: format!("adapter-{engine}"),
            engine: engine.into(),
            family: "keyvalue".into(),
            label: if engine == "valkey" {
                "Valkey".into()
            } else {
                "Redis".into()
            },
            maturity: if engine == "valkey" {
                "beta".into()
            } else {
                "stable".into()
            },
            capabilities: vec![
                "supports_key_browser".into(),
                "supports_ttl_management".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_user_role_browser".into(),
                "supports_permission_inspection".into(),
                "supports_import_export".into(),
            ],
            default_language: "redis".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&format!("{engine}.key.export").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.import").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.rename").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.copy").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.move").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.expire").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.key.persist").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.stream.ack").as_str()));
        assert!(operation_ids.contains(&format!("{engine}.stream.delete-entry").as_str()));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == format!("{engine}.key.import"))
                .map(|operation| operation.risk.as_str()),
            Some("write")
        );
        let key_import = operations
            .iter()
            .find(|operation| operation.id == format!("{engine}.key.import"))
            .expect("key import operation");
        assert_eq!(key_import.execution_support, "live");
        assert_eq!(key_import.preview_only, Some(false));
        assert!(key_import.disabled_reason.is_none());
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == format!("{engine}.stream.delete-entry"))
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
    }
}

#[test]
fn memcached_operation_manifest_exposes_known_key_previews() {
    let manifest = AdapterManifest {
        id: "adapter-memcached".into(),
        engine: "memcached".into(),
        family: "keyvalue".into(),
        label: "Memcached".into(),
        maturity: "stable".into(),
        capabilities: vec![
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_metrics_collection".into(),
        ],
        default_language: "text".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"memcached.stats.reset"));
    assert!(operation_ids.contains(&"memcached.cache.flush"));
    assert!(operation_ids.contains(&"memcached.key.get"));
    assert!(operation_ids.contains(&"memcached.key.gets"));
    assert!(operation_ids.contains(&"memcached.key.set"));
    assert!(operation_ids.contains(&"memcached.key.touch"));
    assert!(operation_ids.contains(&"memcached.key.increment"));
    assert!(operation_ids.contains(&"memcached.key.decrement"));
    assert!(operation_ids.contains(&"memcached.key.delete"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "memcached.cache.flush")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "memcached.key.delete")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
}

#[test]
fn wave_four_document_operation_manifests_expose_native_management_previews() {
    let cosmos_manifest = AdapterManifest {
        id: "adapter-cosmosdb".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        label: "Cosmos DB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_result_snapshots".into(),
            "supports_schema_browser".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_cost_estimation".into(),
        ],
        default_language: "sql".into(),
        local_database: None,
        tree: None,
    };
    let litedb_manifest = AdapterManifest {
        id: "adapter-litedb".into(),
        engine: "litedb".into(),
        family: "document".into(),
        label: "LiteDB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_result_snapshots".into(),
            "supports_schema_browser".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_import_export".into(),
            "supports_backup_restore".into(),
        ],
        default_language: "json".into(),
        local_database: None,
        tree: None,
    };

    let cosmos_ids = operation_manifests_for_manifest(&cosmos_manifest)
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    assert!(cosmos_ids.contains(&"cosmosdb.throughput.update".into()));
    assert!(cosmos_ids.contains(&"cosmosdb.consistency.update".into()));
    assert!(cosmos_ids.contains(&"cosmosdb.regions.failover".into()));

    let litedb_operations = operation_manifests_for_manifest(&litedb_manifest);
    let litedb_ids = litedb_operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();
    assert!(litedb_ids.contains(&"litedb.storage.checkpoint"));
    assert!(litedb_ids.contains(&"litedb.storage.compact"));
    assert!(litedb_ids.contains(&"litedb.storage.rebuild-indexes"));
    assert!(litedb_ids.contains(&"litedb.data.import-export"));
    assert!(litedb_ids.contains(&"litedb.file-storage.import"));
    assert!(litedb_ids.contains(&"litedb.file-storage.export"));
    assert!(litedb_ids.contains(&"litedb.file-storage.delete"));
    assert!(litedb_ids.contains(&"litedb.data.backup-restore"));
    assert_eq!(
        litedb_operations
            .iter()
            .find(|operation| operation.id == "litedb.storage.compact")
            .map(|operation| operation.risk.as_str()),
        Some("costly")
    );
    let litedb_import_export = litedb_operations
        .iter()
        .find(|operation| operation.id == "litedb.data.import-export")
        .expect("LiteDB import/export operation");
    assert_eq!(litedb_import_export.execution_support, "live");
    assert_eq!(litedb_import_export.preview_only, Some(false));
    assert!(litedb_import_export.disabled_reason.is_none());
    for operation_id in [
        "litedb.index.create",
        "litedb.index.drop",
        "litedb.object.drop",
        "litedb.file-storage.import",
        "litedb.file-storage.export",
        "litedb.file-storage.delete",
    ] {
        let operation = litedb_operations
            .iter()
            .find(|operation| operation.id == operation_id)
            .expect("LiteDB management operation");
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
        assert!(operation.disabled_reason.is_none());
        assert!(operation.description.contains("configured sidecar"));
    }
    let litedb_compact = litedb_operations
        .iter()
        .find(|operation| operation.id == "litedb.storage.compact")
        .expect("LiteDB compact operation");
    assert_eq!(litedb_compact.execution_support, "plan-only");
    assert_eq!(litedb_compact.preview_only, Some(true));
}

#[test]
fn operation_manifests_keep_risky_and_plan_only_states_explicit() {
    for maturity in ["stable", "beta"] {
        let manifest = AdapterManifest {
            id: format!("adapter-{maturity}"),
            engine: format!("engine-{maturity}"),
            family: "sql".into(),
            label: format!("Engine {maturity}"),
            maturity: maturity.into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_explain_plan".into(),
                "supports_plan_visualization".into(),
                "supports_query_profile".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_permission_inspection".into(),
                "supports_import_export".into(),
                "supports_backup_restore".into(),
                "supports_metrics_collection".into(),
            ],
            default_language: "sql".into(),
            local_database: None,
            tree: None,
        };

        for operation in operation_manifests_for_manifest(&manifest) {
            if matches!(operation.risk.as_str(), "write" | "destructive" | "costly") {
                assert!(
                    operation.requires_confirmation,
                    "{} must require confirmation",
                    operation.id
                );
            }

            if operation.execution_support != "live" {
                assert!(
                    operation
                        .disabled_reason
                        .as_deref()
                        .is_some_and(|reason| !reason.trim().is_empty()),
                    "{} must explain why it is not live",
                    operation.id
                );
            }
        }
    }
}

#[test]
fn duckdb_operation_manifest_exposes_local_analytics_previews() {
    let manifest = AdapterManifest {
        id: "adapter-duckdb".into(),
        engine: "duckdb".into(),
        family: "embedded-olap".into(),
        label: "DuckDB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_import_export".into(),
        ],
        default_language: "sql".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"duckdb.table.analyze"));
    assert!(operation_ids.contains(&"duckdb.database.analyze"));
    assert!(operation_ids.contains(&"duckdb.database.checkpoint"));
    assert!(operation_ids.contains(&"duckdb.extension.install"));
    assert!(operation_ids.contains(&"duckdb.extension.load"));
    assert!(operation_ids.contains(&"duckdb.file.import"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "duckdb.table.analyze")
            .map(|operation| operation.risk.as_str()),
        Some("costly")
    );
}

#[test]
fn postgresql_operation_manifest_exposes_native_maintenance_previews() {
    let manifest = AdapterManifest {
        id: "adapter-postgresql".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        label: "PostgreSQL".into(),
        maturity: "stable".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_query_profile".into(),
            "supports_query_cancellation".into(),
            "supports_user_role_browser".into(),
        ],
        default_language: "sql".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"postgresql.routine.execute"));
    assert!(operation_ids.contains(&"postgresql.session.cancel"));
    assert!(operation_ids.contains(&"postgresql.session.terminate"));
    assert!(operation_ids.contains(&"postgresql.table.analyze"));
    assert!(operation_ids.contains(&"postgresql.table.vacuum"));
    assert!(operation_ids.contains(&"postgresql.database.analyze"));
    assert!(operation_ids.contains(&"postgresql.database.vacuum"));
    assert!(operation_ids.contains(&"postgresql.index.reindex"));
    assert!(operation_ids.contains(&"postgresql.role.grant"));
    assert!(operation_ids.contains(&"postgresql.role.revoke"));
    assert!(operation_ids.contains(&"postgresql.extension.update"));
    assert!(operation_ids.contains(&"postgresql.extension.drop"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "postgresql.routine.execute")
            .map(|operation| operation.risk.as_str()),
        Some("write")
    );
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "postgresql.session.terminate")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "postgresql.index.reindex")
            .map(|operation| operation.risk.as_str()),
        Some("costly")
    );
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "postgresql.extension.drop")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
}

#[test]
fn sqlserver_operation_manifest_exposes_native_maintenance_previews() {
    let manifest = AdapterManifest {
        id: "adapter-sqlserver".into(),
        engine: "sqlserver".into(),
        family: "sql".into(),
        label: "SQL Server".into(),
        maturity: "stable".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_query_profile".into(),
        ],
        default_language: "sql".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"sqlserver.statistics.update"));
    assert!(operation_ids.contains(&"sqlserver.index.reorganize"));
    assert!(operation_ids.contains(&"sqlserver.index.rebuild"));
    assert!(operation_ids.contains(&"sqlserver.index.disable"));
    assert!(operation_ids.contains(&"sqlserver.index.enable"));
    assert!(operation_ids.contains(&"sqlserver.query-store.top-queries"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "sqlserver.index.disable")
            .map(|operation| operation.risk.as_str()),
        Some("write")
    );
}

#[test]
fn search_operation_manifest_exposes_native_admin_previews() {
    let manifest = AdapterManifest {
        id: "adapter-elasticsearch".into(),
        engine: "elasticsearch".into(),
        family: "search".into(),
        label: "Elasticsearch".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_index_management".into(),
            "supports_query_profile".into(),
            "supports_import_export".into(),
            "supports_backup_restore".into(),
        ],
        default_language: "query-dsl".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"elasticsearch.index.force-merge"));
    assert!(operation_ids.contains(&"elasticsearch.index.reindex"));
    assert!(operation_ids.contains(&"elasticsearch.index.put-mapping"));
    assert!(operation_ids.contains(&"elasticsearch.index.update-settings"));
    assert!(operation_ids.contains(&"elasticsearch.alias.put"));
    assert!(operation_ids.contains(&"elasticsearch.alias.delete"));
    assert!(operation_ids.contains(&"elasticsearch.lifecycle.explain"));
    assert!(operation_ids.contains(&"elasticsearch.data-stream.rollover"));
    assert!(operation_ids.contains(&"elasticsearch.template.create"));
    assert!(operation_ids.contains(&"elasticsearch.lifecycle.put"));
    assert!(operation_ids.contains(&"elasticsearch.pipeline.put"));
    assert!(operation_ids.contains(&"elasticsearch.pipeline.simulate"));
    assert!(operation_ids.contains(&"elasticsearch.task.cancel"));
    assert!(operation_ids.contains(&"elasticsearch.diagnostics.slow-log"));
    assert!(operation_ids.contains(&"elasticsearch.diagnostics.allocation"));
    assert!(operation_ids.contains(&"elasticsearch.data.import-export"));
    assert!(operation_ids.contains(&"elasticsearch.snapshot.restore"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "elasticsearch.snapshot.restore")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
}

#[test]
fn wave_five_operation_manifest_exposes_timeseries_and_graph_previews() {
    let prometheus_manifest = AdapterManifest {
        id: "adapter-prometheus".into(),
        engine: "prometheus".into(),
        family: "timeseries".into(),
        label: "Prometheus".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_query_profile".into(),
            "supports_metrics_collection".into(),
        ],
        default_language: "promql".into(),
        local_database: None,
        tree: None,
    };
    let influx_manifest = AdapterManifest {
        id: "adapter-influxdb".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        label: "InfluxDB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_permission_inspection".into(),
            "supports_query_profile".into(),
            "supports_metrics_collection".into(),
            "supports_import_export".into(),
        ],
        default_language: "influxql".into(),
        local_database: None,
        tree: None,
    };
    let opentsdb_manifest = AdapterManifest {
        id: "adapter-opentsdb".into(),
        engine: "opentsdb".into(),
        family: "timeseries".into(),
        label: "OpenTSDB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_metrics_collection".into(),
            "supports_import_export".into(),
        ],
        default_language: "opentsdb".into(),
        local_database: None,
        tree: None,
    };
    let neptune_manifest = AdapterManifest {
        id: "adapter-neptune".into(),
        engine: "neptune".into(),
        family: "graph".into(),
        label: "Amazon Neptune".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_graph_view".into(),
            "supports_result_snapshots".into(),
            "supports_explain_plan".into(),
            "supports_plan_visualization".into(),
            "supports_query_profile".into(),
            "supports_cloud_iam".into(),
            "supports_metrics_collection".into(),
            "supports_import_export".into(),
        ],
        default_language: "gremlin".into(),
        local_database: None,
        tree: None,
    };

    let prometheus_ids = operation_manifests_for_manifest(&prometheus_manifest)
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    assert!(prometheus_ids.contains(&"prometheus.cardinality.analyze".into()));

    let influx_ids = operation_manifests_for_manifest(&influx_manifest)
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    assert!(influx_ids.contains(&"influxdb.retention.update".into()));
    assert!(influx_ids.contains(&"influxdb.security.inspect".into()));

    let opentsdb_ids = operation_manifests_for_manifest(&opentsdb_manifest)
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    assert!(opentsdb_ids.contains(&"opentsdb.uid.repair".into()));

    let neptune_operations = operation_manifests_for_manifest(&neptune_manifest);
    let neptune_ids = neptune_operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();
    assert!(neptune_ids.contains(&"neptune.security.inspect"));
    assert!(neptune_ids.contains(&"neptune.data.import-export"));
    assert_eq!(
        neptune_operations
            .iter()
            .find(|operation| operation.id == "neptune.security.inspect")
            .map(|operation| operation.required_capabilities.as_slice()),
        Some(&["supports_cloud_iam".to_string()][..])
    );
}

#[test]
fn wave_three_widecolumn_operation_manifest_exposes_import_backup_and_capacity_previews() {
    let dynamodb_manifest = AdapterManifest {
        id: "adapter-dynamodb".into(),
        engine: "dynamodb".into(),
        family: "widecolumn".into(),
        label: "DynamoDB".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_permission_inspection".into(),
            "supports_metrics_collection".into(),
            "supports_cost_estimation".into(),
            "supports_import_export".into(),
            "supports_backup_restore".into(),
        ],
        default_language: "json".into(),
        local_database: None,
        tree: None,
    };
    let cassandra_manifest = AdapterManifest {
        id: "adapter-cassandra".into(),
        engine: "cassandra".into(),
        family: "widecolumn".into(),
        label: "Cassandra".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
            "supports_index_management".into(),
            "supports_permission_inspection".into(),
            "supports_query_profile".into(),
            "supports_metrics_collection".into(),
            "supports_import_export".into(),
            "supports_backup_restore".into(),
        ],
        default_language: "cql".into(),
        local_database: None,
        tree: None,
    };

    let dynamodb_operations = operation_manifests_for_manifest(&dynamodb_manifest);
    let dynamodb_ids = dynamodb_operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();
    assert!(dynamodb_ids.contains(&"dynamodb.capacity.update"));
    assert!(dynamodb_ids.contains(&"dynamodb.ttl.update"));
    assert!(dynamodb_ids.contains(&"dynamodb.streams.update"));
    assert!(dynamodb_ids.contains(&"dynamodb.backup.create"));
    assert!(dynamodb_ids.contains(&"dynamodb.backup.restore"));
    assert!(dynamodb_ids.contains(&"dynamodb.data.import-export"));
    assert!(dynamodb_ids.contains(&"dynamodb.data.backup-restore"));

    let cassandra_operations = operation_manifests_for_manifest(&cassandra_manifest);
    let cassandra_ids = cassandra_operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();
    assert!(cassandra_ids.contains(&"cassandra.query.profile"));
    assert!(cassandra_ids.contains(&"cassandra.index.create"));
    assert!(cassandra_ids.contains(&"cassandra.data.import-export"));
    assert!(cassandra_ids.contains(&"cassandra.data.backup-restore"));
    assert_eq!(
        cassandra_operations
            .iter()
            .find(|operation| operation.id == "cassandra.data.backup-restore")
            .map(|operation| operation.risk.as_str()),
        Some("destructive")
    );
}

#[test]
fn clickhouse_operation_manifest_exposes_native_table_maintenance_previews() {
    let manifest = AdapterManifest {
        id: "adapter-clickhouse".into(),
        engine: "clickhouse".into(),
        family: "warehouse".into(),
        label: "ClickHouse".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
        ],
        default_language: "clickhouse-sql".into(),
        local_database: None,
        tree: None,
    };

    let operations = operation_manifests_for_manifest(&manifest);
    let operation_ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(operation_ids.contains(&"clickhouse.table.optimize"));
    assert!(operation_ids.contains(&"clickhouse.table.materialize-ttl"));
    assert!(operation_ids.contains(&"clickhouse.table.freeze"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "clickhouse.table.materialize-ttl")
            .map(|operation| operation.risk.as_str()),
        Some("costly")
    );
}

#[test]
fn cloud_warehouse_manifest_exposes_native_admin_previews() {
    let snowflake_manifest = AdapterManifest {
        id: "adapter-snowflake".into(),
        engine: "snowflake".into(),
        family: "warehouse".into(),
        label: "Snowflake".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
        ],
        default_language: "snowflake-sql".into(),
        local_database: None,
        tree: None,
    };
    let bigquery_manifest = AdapterManifest {
        id: "adapter-bigquery".into(),
        engine: "bigquery".into(),
        family: "warehouse".into(),
        label: "BigQuery".into(),
        maturity: "beta".into(),
        capabilities: vec![
            "supports_schema_browser".into(),
            "supports_result_snapshots".into(),
            "supports_admin_operations".into(),
        ],
        default_language: "google-sql".into(),
        local_database: None,
        tree: None,
    };

    let snowflake_operations = operation_manifests_for_manifest(&snowflake_manifest);
    let snowflake_ids = snowflake_operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();
    assert!(snowflake_ids.contains(&"snowflake.table.clone"));
    assert!(snowflake_ids.contains(&"snowflake.warehouse.suspend"));
    assert!(snowflake_ids.contains(&"snowflake.warehouse.resume"));
    assert_eq!(
        snowflake_operations
            .iter()
            .find(|operation| operation.id == "snowflake.table.clone")
            .map(|operation| operation.scope.as_str()),
        Some("table")
    );

    let bigquery_operations = operation_manifests_for_manifest(&bigquery_manifest);
    assert!(bigquery_operations
        .iter()
        .any(|operation| operation.id == "bigquery.table.copy" && operation.risk == "write"));
}
