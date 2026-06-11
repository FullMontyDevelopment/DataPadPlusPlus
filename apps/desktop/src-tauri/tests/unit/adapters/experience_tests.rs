use super::super::registry::manifests;
use super::*;

fn experience_for_engine(engine: &str) -> DatastoreExperienceManifest {
    let manifest = manifests()
        .into_iter()
        .find(|manifest| manifest.engine == engine)
        .unwrap_or_else(|| panic!("missing {engine} manifest"));

    experience_manifest_for_manifest(&manifest)
}

#[test]
fn reference_engines_advertise_native_live_edit_scopes() {
    let mongo = experience_for_engine("mongodb");
    let mongo_scope = mongo
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "collection")
        .expect("Mongo collection edit scope");

    assert!(mongo_scope.live_execution);
    assert!(mongo_scope
        .edit_kinds
        .iter()
        .any(|kind| kind == "insert-document"));
    assert!(mongo_scope
        .edit_kinds
        .iter()
        .any(|kind| kind == "rename-field"));
    assert!(mongo_scope
        .edit_kinds
        .iter()
        .any(|kind| kind == "update-document"));
    assert!(mongo_scope
        .edit_kinds
        .iter()
        .any(|kind| kind == "delete-document"));

    let redis = experience_for_engine("redis");
    let redis_scope = redis
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "key")
        .expect("missing Redis key edit scope");
    assert!(redis_scope.live_execution);
    for edit_kind in [
        "set-key-value",
        "set-ttl",
        "rename-key",
        "hash-set-field",
        "stream-add-entry",
        "stream-delete-entry",
        "timeseries-add-sample",
        "timeseries-delete-sample",
        "json-set-path",
        "json-delete-path",
        "vector-add-member",
        "vector-remove-member",
        "vector-set-attributes",
    ] {
        assert!(
            redis_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
            "Redis missing {edit_kind}"
        );
    }

    let valkey = experience_for_engine("valkey");
    let valkey_scope = valkey
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "key")
        .expect("missing Valkey key edit scope");
    assert!(valkey_scope.live_execution);
    for edit_kind in [
        "set-key-value",
        "set-ttl",
        "rename-key",
        "hash-set-field",
        "stream-add-entry",
        "stream-delete-entry",
    ] {
        assert!(
            valkey_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
            "Valkey missing {edit_kind}"
        );
    }
    for edit_kind in [
        "json-set-path",
        "json-delete-path",
        "timeseries-add-sample",
        "timeseries-delete-sample",
        "vector-add-member",
        "vector-remove-member",
        "vector-set-attributes",
    ] {
        assert!(
            !valkey_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
            "Valkey should hide Redis module edit kind {edit_kind}"
        );
    }
}

#[test]
fn litedb_advertises_scoped_live_document_crud_scope() {
    let litedb = experience_for_engine("litedb");
    let scope = litedb
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "collection")
        .expect("missing LiteDB collection edit scope");

    assert!(scope.live_execution);
    assert!(scope.requires_primary_key);
    assert_eq!(
        scope.edit_kinds,
        vec![
            "insert-document".to_string(),
            "update-document".to_string(),
            "delete-document".to_string()
        ]
    );
}

#[test]
fn core_sql_engines_advertise_live_primary_key_row_edit_scopes() {
    for engine in [
        "postgresql",
        "cockroachdb",
        "sqlserver",
        "mysql",
        "mariadb",
        "sqlite",
        "timescaledb",
        "oracle",
    ] {
        let experience = experience_for_engine(engine);
        let table_scope = experience
            .editable_scopes
            .iter()
            .find(|scope| scope.scope == "table")
            .unwrap_or_else(|| panic!("missing {engine} table edit scope"));

        assert!(
            table_scope.live_execution,
            "{engine} table row edits should be live-capable"
        );
        assert!(
            table_scope.requires_primary_key,
            "{engine} row updates/deletes should require primary-key identity"
        );
        for edit_kind in ["insert-row", "update-row", "delete-row"] {
            assert!(
                table_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
                "{engine} missing {edit_kind}"
            );
        }

        assert!(
            experience
                .query_builders
                .iter()
                .any(|builder| builder.kind == "sql-select"),
            "{engine} should expose the SQL SELECT builder"
        );
    }
}

#[test]
fn search_and_dynamodb_advertise_live_edit_scopes_while_cassandra_stays_plan_only() {
    for engine in ["elasticsearch", "opensearch"] {
        let experience = experience_for_engine(engine);
        let index_scope = experience
            .editable_scopes
            .iter()
            .find(|scope| scope.scope == "index")
            .unwrap_or_else(|| panic!("missing {engine} index edit scope"));

        assert!(
            index_scope.live_execution,
            "{engine} explicit-id document edits should be live-capable"
        );
        assert!(
            index_scope.requires_primary_key,
            "{engine} document edits should require explicit document identity"
        );
        for edit_kind in ["index-document", "update-document", "delete-document"] {
            assert!(
                index_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
                "{engine} missing {edit_kind}"
            );
        }
    }

    let dynamodb = experience_for_engine("dynamodb");
    let item_scope = dynamodb
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "table")
        .expect("DynamoDB item edit scope");

    assert!(item_scope.live_execution);
    assert!(item_scope.requires_primary_key);
    for edit_kind in ["put-item", "update-item", "delete-item"] {
        assert!(
            item_scope.edit_kinds.iter().any(|kind| kind == edit_kind),
            "DynamoDB missing {edit_kind}"
        );
    }

    let cassandra = experience_for_engine("cassandra");
    let row_scope = cassandra
        .editable_scopes
        .iter()
        .find(|scope| scope.scope == "table")
        .expect("Cassandra row edit scope");

    assert!(
        !row_scope.live_execution,
        "Cassandra row edits stay contract-plan-only until a live CQL driver path exists"
    );
    assert!(row_scope.requires_primary_key);
    assert!(row_scope.edit_kinds.iter().any(|kind| kind == "update-row"));
}

#[test]
fn analytics_engines_advertise_sql_builders_without_edit_scopes() {
    for engine in ["duckdb", "clickhouse", "snowflake", "bigquery"] {
        let experience = experience_for_engine(engine);

        assert!(
            experience.query_builders.iter().any(|builder| {
                builder.kind == "sql-select"
                    && builder.default_mode == "raw"
                    && builder.scope == "table"
            }),
            "{engine} should expose the SQL SELECT builder"
        );
        assert!(
            experience.editable_scopes.is_empty(),
            "{engine} should not advertise live row edits in this wave"
        );
    }
}

#[test]
fn wave_five_engines_advertise_query_builders_without_edit_scopes() {
    for (engine, kind) in [
        ("prometheus", "timeseries-query"),
        ("influxdb", "timeseries-query"),
        ("opentsdb", "timeseries-query"),
        ("neo4j", "graph-query"),
        ("arango", "graph-query"),
        ("janusgraph", "graph-query"),
        ("neptune", "graph-query"),
    ] {
        let experience = experience_for_engine(engine);

        assert!(
            experience.query_builders.iter().any(|builder| {
                builder.kind == kind && builder.default_mode == "split" && builder.scope == "query"
            }),
            "{engine} should expose {kind}"
        );
        assert!(
            experience.editable_scopes.is_empty(),
            "{engine} should keep edit/admin writes preview-first"
        );
    }
}
