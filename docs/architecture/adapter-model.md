# Adapter Model

DataPad++ uses a capability-driven adapter system so the desktop app can add new datastore engines without rewriting the shell. The model has two related pieces:

- adapter manifests describe what an engine can technically do
- datastore experience manifests describe how that capability should appear in the product

## Adapter Contract

Every adapter should supply:

- identity metadata: engine id, display name, family, maturity, query language, connection modes, default port, and renderer support
- connection schema and validation rules
- capability declarations
- metadata discovery and explorer inspection handlers
- query or command execution handlers
- result serializers and pagination support
- operation manifests and guarded operation planning
- permission inspection and disabled-action reasons
- diagnostics for plans, profiles, metrics, series, query history, and warnings
- error normalization and user-facing hints

Mature adapters can also add safe live edit support for natural data edits. These edits are separate from destructive/admin operations and must be identity-safe.

## Experience Manifest

`DatastoreExperienceManifest` is the UI-facing registry for engine-specific experience details. It should describe:

- object kinds such as table, schema, collection, index, key, data stream, keyspace, or bucket
- context-menu actions for connections and explorer nodes
- query builders and the object scopes they support
- editable scopes and safe edit shapes
- result renderers to prioritize
- diagnostics tabs and metrics panels
- import/export and backup/restore affordances
- safety rules, confirmation text, and read-only behavior

Use the experience manifest to add engine-specific product polish without spreading one-off checks across the workbench.

## Capability-First UI

The UI should react to declared capabilities rather than engine names alone.

Examples:

- `supports_sql_editor` enables SQL editor tooling
- `supports_schema_browser` enables schema/table/view explorer surfaces
- `supports_document_view` enables document and JSON-first inspection
- `supports_key_browser` enables Redis/Valkey-style key navigation and TTL management
- `supports_graph_view` enables node-edge visualization
- `supports_time_series_charting` enables chart-centric result rendering
- `supports_visual_query_builder` enables query-builder toolbar controls when an experience manifest supplies a builder
- `supports_explain_plan` and `supports_query_profile` enable plan/profile actions and warnings
- `supports_permission_inspection` enables security/disabled-action panels

Capability flags must not overpromise. An adapter should only claim a capability when at least one explorer surface, operation, diagnostic, renderer, or builder uses it.

## Query Builders

Builders are optional and should emit the same raw text/API payload the adapter already executes. The raw query and builder are layout modes inside one query tab.

Current builder families:

- MongoDB find builder
- SQL SELECT builder
- DynamoDB key-condition builder
- Cassandra partition-key CQL builder
- Elasticsearch/OpenSearch Query DSL builder

Builders should support drag-and-drop field input when the result renderer can provide a field path and sample value.

## Result Normalization

Adapters should normalize outputs into renderer-friendly envelopes:

- `table`
- `json`
- `document`
- `keyvalue`
- `raw`
- `schema`
- `diff`
- `plan`
- `metrics`
- `series`
- `searchHits`
- `graph`
- `profile`
- `costEstimate`

Payloads should contain returned data, not submitted query text. Execution metadata belongs in messages, details, diagnostics, or profile payloads.

## Safe Edits And Guarded Operations

DataPad++ uses two mutation paths:

- safe live data edits for natural row/document/key/item changes when the adapter has a complete identity and can build a parameterized/native request
- guarded operation plans for destructive/admin/schema/costly workflows

Examples of safe live edit candidates:

- SQL row update/delete/insert with table and primary-key context
- MongoDB field set/unset/rename/type-change with a document id
- Redis/Valkey value or TTL edits with a concrete key
- DynamoDB item edits with complete partition/sort keys
- Cassandra row edits with complete primary-key conditions

Destructive/admin operations such as drop table, delete collection, add/drop index, backup/restore, import/export, repair, compaction, and cloud-cost operations should remain plan-first unless a later production policy explicitly enables execution.

## Core Completion Priority

The current core+popular completion set is:

- PostgreSQL
- CockroachDB
- SQL Server / Azure SQL
- MySQL
- MariaDB
- SQLite
- MongoDB
- Redis / Valkey
- Elasticsearch / OpenSearch
- DynamoDB
- Cassandra

Other engines remain beta, contract-backed, fixture-backed, or roadmap-oriented until their native execution, identity, permission, and diagnostics surfaces are hardened.

For the current per-engine gap list and recommended completion order, see the [Datastore Readiness And Completion Plan](datastore-readiness.md).
