# Native Datastore Transfers

Data transfer is distinct from result export, workspace backup, and datastore backup:

- **Result export** writes the current result payload.
- **Data import/export** moves selected datastore objects through a native or portable format.
- **Workspace backup** preserves DataPad++ configuration and saved work.
- **Datastore backup/restore** uses a genuine in-process, SQL, sidecar, server, repository, or cloud API when available.

> [!CAUTION]
> DataPad++ is pre-release software and should not be used for production transfers or restores. Validate with disposable targets, verify counts and type checksums independently, and keep vendor-supported backups.

## Workflow

1. Open Import, Export, Backup, or Restore from an eligible object/context action.
2. Confirm the selected object scope.
3. Choose a native or portable format and an allowed destination.
4. Configure mappings and adapter-specific options.
5. Validate schema, type, identity, permissions, conflicts, locks, server compatibility, and expected impact.
6. Review warnings and start the transfer.
7. Follow progress, cancellation, retry, warnings, native job id, and artifact access in Transfers Center.

Local paths stay in the backend behind short-lived selection tokens. Incomplete local output uses a temporary name and is promoted only after success. Resumable journals contain sanitized state and identifiers, never credentials, queries, values, full paths, or signed URIs.

## Status Labels

- **Live:** the selected action has an implemented execution path.
- **Experimental:** user-accessible with an explicit experimental boundary.
- **Plan only:** DataPad++ can describe or validate the workflow but does not execute it.
- **Unavailable:** there is no safe supported in-process or server API under the current product boundary.

Status is action-specific. Live export does not imply live import, backup, or restore.

## Current Data-Transfer Boundaries

Live data import/export is available for PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, MongoDB, Redis, Valkey, LiteDB, DuckDB, CockroachDB, TimescaleDB, Oracle, Elasticsearch, OpenSearch, ClickHouse, Cassandra, InfluxDB, Neo4j, ArangoDB, JanusGraph, DynamoDB, Cosmos DB, and Memcached within their manifest-defined scope.

Prometheus and OpenTSDB provide live bounded export; import is unavailable because the native write APIs cannot satisfy atomic fail-on-conflict behavior. Snowflake, BigQuery, and Neptune data transfer remains plan-only pending authenticated real-service validation.

Native formats include driver COPY streams, Extended JSON/BSON, typed key snapshots, Parquet, native JSON encodings, GraphSON, line protocol, OpenMetrics, search Bulk/PIT streams, and engine-specific backup artifacts. CSV and generic JSON/NDJSON are marked portable or lossy where native types cannot round-trip exactly.

## Current Backup Boundaries

Live native backup/restore is exposed for SQLite, DuckDB, LiteDB, CockroachDB, SQL Server, Oracle Data Pump, ClickHouse, Elasticsearch, and OpenSearch within the destination and isolation rules advertised by their manifests.

ArangoDB, DynamoDB, Cosmos DB, Snowflake, BigQuery, and Neptune expose native API concepts but remain plan-only until edition, control-plane identity, destination isolation, and opt-in real-service validation requirements pass.

Other engines show backup/restore as unavailable when it would require excluded vendor executables, storage-backend access, or a custom pseudo-backup.

## Conflict And Restore Policy

- Import defaults to fail on conflicts.
- DataPad++ does not silently overwrite, upsert, infer schemas, or retry ambiguous writes.
- Imports require existing objects unless the native operation explicitly creates a new isolated target.
- Restore targets are new/empty by default and are rolled back when the runtime created them and the operation fails.
- Read-only connections, environment confirmations, Safe Mode, execution locks, permissions, size bounds, and cancellation apply throughout.

The application capability manifest is the source of truth for the selected engine, action, format, destination, and runtime.
