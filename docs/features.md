# DataPad++ Feature Reference

The [website documentation](https://datapad-plus-plus.org/docs) is the canonical user guide. This document is the repository-level feature reference for contributors and reviewers.

> [!CAUTION]
> DataPad++ is pre-release software and should not be used for production workloads. Capabilities described as live have an implemented execution path; that label does not imply production readiness. Begin with disposable, local, or read-only systems and keep independent backups.

## Workbench

- The Library stores connection profiles, folders, queries, scripts, notes, snippets, test suites, and saved work.
- Environments keep risk, color, variables, read-only posture, and confirmation policy visible across the Explorer, tabs, execution, and results.
- Query tabs preserve their own connection, environment, database/schema or datastore scope, drafts, results, renderer, and pin state.
- Workspace Search finds connections, Library items, open tabs, recently closed tabs, scripts, and enabled test suites.
- Viewport-safe context menus use a body portal, remain within the current window, scroll when necessary, and support keyboard navigation.
- The optional Multi-window Tabs plugin moves working tabs between native windows while the main window retains application-level navigation. See [Multi-window Tabs](multi-window-tabs.md).

## Connections And Secrets

- Connection health starts neutral each session. A badge appears only after a manual test or real datastore operation produces evidence.
- Health is scoped to a connection and environment. Connectivity, authentication, TLS, DNS, credential, and timeout failures can mark a target unhealthy; query syntax or rendering errors do not.
- Native connection fields store modeled credentials in the operating-system credential vault.
- A complete connection string is treated as one opaque secret. DataPad++ does not split or reconstruct it; persistence contains only its vault reference.
- Environment interpolation occurs in memory when the backend resolves a connection for testing or execution.
- Browser preview keeps secrets in memory only and requires them again after reload.

## Explorer And IntelliSense

- Each datastore owns its tree shape, object names, actions, diagnostics, and disabled reasons.
- Server-paged branches expose **Load more** instead of silently truncating large catalogs.
- Metadata-backed IntelliSense combines datastore keywords, functions, discovered objects, fields, aliases, and scoped snippets.
- Oracle loads its selected schema progressively and ignores stale pages after the tab, connection, environment, or schema changes. See [Oracle Support](oracle.md).
- SQL relationship diagrams display tables, declared relationships, optional inferred links, and object inspectors without forcing the complete catalog into one view.

## Querying And Builders

- SQL-family tabs provide a raw editor, metadata-aware completion, bounded execution, query plans, and target scope appropriate to the engine.
- Database/schema selectors carry session scope outside the SQL text where the datastore supports it; generated queries do not need a user-authored `USE` statement.
- MongoDB supports find, aggregation, raw JSON, and guarded script workflows.
- Redis and Valkey provide a key browser plus a read-oriented command console.
- Search, graph, time-series, analytical, cloud, document, and wide-column engines use their native query language or bounded protocol workflow.
- Visual query builders share strict inputs for strings, finite numbers, booleans, dates, UUID/GUID values, MongoDB ObjectIds, JSON, and multi-value operators.
- JSON values open in a larger editor and must explicitly pass validation before applying.
- Unary operators hide value controls. `Has Length` accepts a non-negative integer only.
- Native array operators are exposed only for engines that can execute reliable server-side predicates. See [Query Builders And Document Editing](query-and-document-editing.md).
- Invalid drafts remain editable but cannot run, count, or replace the last successfully compiled query.

## Results And Safe Editing

- Results render as grids, documents, key-value structures, search hits, graph data, metrics, text, plans, status, or raw payloads according to the response.
- Cell previews may remain compact, but full-value actions request authoritative data before viewing or copying it.
- Result exports support payload-appropriate CSV, JSON, NDJSON, text, and raw forms with redaction and explicit overwrite checks.
- SQL edits require stable table and primary-key identity.
- Document edits require collection/container identity, concurrency evidence where supported, and complete immutable-key context.
- Shared document editing supports guarded Add Field, Remove Field, typed values, formatted raw JSON, explicit validation, and authoritative before/after evidence for supported document adapters.
- Redis/Valkey key and member operations require a concrete key, correct native type, read/write permission, and any required confirmation.
- Failed or ambiguous writes do not update the result locally as if the server accepted them.

## Key-Value Workflows

- Namespace delimiter and search-pattern drafts remain stable while users type; refresh happens only through the deliberate search workflow.
- Scalar values do not expose meaningless expandable rows.
- The full-value inspector shows the field/key name, type and size metadata, source or formatted JSON views, copy actions, and guarded editing.
- Large values are streamed/read through the full-value request path instead of copying a truncated preview. See [Key-Value Inspection](key-value-inspection.md).

## Datastore Transfer

- The application-level transfer dialog stages selection, scope, format, destination, options, validation, review, and start.
- Local paths stay backend-owned and are represented in the frontend by short-lived selection tokens.
- Formats are identified as native, portable, or potentially lossy.
- Imports fail on conflicts by default. DataPad++ does not silently overwrite or upsert existing data.
- The Transfers Center tracks background jobs, progress, cancellation, warnings, resumable native job identifiers, and completed artifacts.
- Native backup/restore appears only where an in-process driver, sidecar, SQL command, or server/cloud API supports it. Unsupported workflows remain visibly unavailable.
- Browser preview may describe a plan but cannot execute desktop file, server-path, or cloud transfer operations.

See [Native Datastore Transfers](datastore-transfers.md) for the status model and operator workflow. Exact capability is always determined by the selected connection's runtime manifest.

## Workspaces And Backups

- Workspace schema version 12 is the synchronized TypeScript/Rust contract. Schema version, workspace revision, and encrypted bundle format version are separate concepts.
- Legacy workspaces are normalized and migrated transactionally. Newer unsupported schemas fail with an actionable error instead of being downgraded.
- Persistent workspace state retains reconstructible drafts, saved work, targets, environment context, and layout while omitting refreshable result/diagnostic payloads.
- Execution history is bounded independently from saved queries and current drafts.
- Workspace export produces a compact, compressed, authenticated, encrypted `.datapadpp-workspace` bundle.
- Exports exclude secrets by default. Secret-inclusive export requires every selected vault reference to resolve.
- Import is file-first: select, unlock, review, name, choose import-as-new or replace-current, then explicitly opt into bundled secrets.
- Replace and restore workflows create recovery state and commit only after validation, vault writes, and durable persistence succeed.
- Workspace size analysis reports byte counts by section and tab without exposing query, payload, or secret contents.

See [Settings, Workspaces, And Backups](settings-and-workspace.md).

## Plugins And Integrations

- API Server profiles deliberately expose selected resources or saved queries over local REST/OpenAPI, GraphQL, or gRPC surfaces.
- MCP Server profiles bind locally, require scoped bearer credentials, and expose only enabled read-oriented tools and contexts.
- Datastore Security Checks separate curated vulnerability/version evidence from bounded read-only posture checks.
- Datastore Tests provide target-bound suites, preflight, adapter-backed observations, focused assertions, and guarded execution.
- Experimental plugins are disabled by default and identify desktop/browser and platform limitations in Settings.

## Datastore Coverage

DataPad++ declares 29 engines across SQL, document, key-value, search, warehouse/analytical, time-series/metrics, and graph families. Support is operation-specific:

- **Live** means an implemented execution path exists for the selected operation.
- **Experimental** means the path is user-accessible but still carries an explicit experimental boundary.
- **Plan only** means DataPad++ can validate or describe the workflow but does not execute it.
- **Unavailable** means the required safe in-process or server API is not supported.

Do not infer one operation's maturity from another. A datastore can have live queries and exports while native restore or cloud administration remains plan-only. The application capability manifest and current adapter tests are authoritative; the [readiness reference](architecture/datastore-readiness.md) and [completion tracker](architecture/native-completion-tracker.md) retain engineering history.

## Safety Model

- Read-only profiles fail closed for writes and unknown statements.
- Environment guardrails remain independent from global Safe Mode.
- Destructive, costly, administrative, transfer, and restore operations show scope, risk, required permissions, and confirmation requirements.
- Stable identity, immutable paths, partition/shard keys, concurrency tokens, and execution locks are checked before mutation.
- Credentials, connection strings, queries, payloads, local paths, signed URIs, and secret values must not appear in diagnostics or persisted job metadata.
- Cancellation, failure, and success are distinct outcomes; a canceled picker or caught failure is never reported as completion.

See [Security And Safety](architecture/security-and-safety.md) for the contributor contract.
