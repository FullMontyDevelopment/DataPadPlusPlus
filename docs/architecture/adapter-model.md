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

These surfaces are explicit adapter hooks. The default adapter may build an unsupported or preview response, but it must not silently perform network or mutation work. Planned engines use an explicit family provider rather than inheriting engine-specific behavior from the default implementation.

## Provider Ownership

The adapter registry contains composition only: one engine registration points to one concrete adapter. Operational behavior belongs to the engine slice (`catalog`, `tree`, `experience`, `operations`, `editing`, `explorer`, `query`, `diagnostics`, and `import_export` as applicable). Reusable family behavior belongs under `datastores/common/<family>` and must not import a concrete engine provider or switch on an engine id.

Subsystem registries are intentionally separate from the adapter registry:

- API Server providers own resource kinds, identities, datastore read/mutation requests, and schema hints.
- MCP read-policy providers own datastore read-only classification while common authentication and loopback policy run before dispatch.
- Security-check providers own version mapping, profile posture, and bounded deep probes; common code owns cache/source orchestration and finding sanitization.
- Runtime and workbench slices own browser-preview execution, tree placement, object actions, query targets/templates, builder serialization, and datastore-native Explorer presentation.

Every declared engine registers exactly one `DatastoreExplorerProvider` and one
`DatastoreObjectViewProvider`. An Explorer provider declares the native hierarchy,
detail providers for every node kind, cache-versus-inspection ownership, paging,
launch surfaces, system namespaces, and optional secondary relationship maps. The
sidebar and Explorer tab consume the same provider and scope cache so their loaded
nodes, continuation state, errors, and retries cannot diverge.

Shared Explorer code owns only the two-pane shell, keyboard and responsive drawer
behavior, bounded structured-value rendering, paging state, and safe error
presentation. It does not choose an engine or display provider payloads directly.
Known node kinds must have one purpose-built detail provider; unknown nodes show
safe context without exposing their payload. Explorer is read-only and hands query,
edit, and administrative work to existing guarded workflows.

Object-view providers own the operational workspace for their engine. The shell
owns the single title, breadcrumb, refresh, and primary navigation action.
Inventories, metrics, security, health, diagnostics, and administration are
separated into restrained bordered sections. Native SQL, scripts, DDL, pipelines,
or request previews are shown only when the text is itself the useful artifact.

Provider registries contain composition only and reject missing or duplicate engine
registrations. There is no generic Explorer, generic object-view, or fabricated
browser-inspection fallback.

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

## Datastore Test Execution Providers

The experimental Datastore Tests plugin uses a bounded `DatastoreTestExecutionProvider` registry. The registry is composition-only: PostgreSQL, SQLite, MongoDB, Redis, Valkey, and DynamoDB register explicit providers, and an unregistered datastore is unsupported rather than routed through a family fallback.

Providers declare supported step kinds, accepted target kinds, target validation, inferred query language, target-aware starter generation, and whether a case has a persistent datastore session. Shared orchestration owns suite/case ordering, immutable-binding enforcement, target propagation, preflight expiry and one-time confirmation, variable precedence, safety policy, redaction, timeouts, assertion evaluation, status aggregation, and result persistence. It does not choose syntax or language by engine name. Providers reach datastore work only through adapter-owned execution hooks. The default path cannot synthesize success or perform hidden network work.

Each suite owns one connection/environment/target binding, mirrored into its query tab. Structured query-builder, data-edit, and operation plans must remain contained by that target. Raw requests receive explicit warnings when target locality cannot be proven. The target and provider-inferred language participate in the revision fingerprint, preventing a stale or corrupted plan from crossing bindings.

Query and builder steps currently use validated adapter execution. Data-edit and operation steps remain editable but are blocked until their provider has real planning, execution, cancellation, target-containment, and fixture evidence. This keeps capability claims aligned with executable behavior.

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
