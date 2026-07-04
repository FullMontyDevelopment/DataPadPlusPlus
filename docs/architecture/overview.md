# Architecture Overview

DataPad++ is structured as a modular desktop datastore workstation with clear boundaries between the React workbench, product orchestration, shared contracts, datastore adapters, and privileged native services.

For the current end-user surface, start with the [Feature Guide](../features.md). This document focuses on how the product is assembled.

## Layers

### UI Layer

The React desktop shell owns:

- the unified Library sidebar, closeable workbench tabs, settings workspace, bottom/right results panels, and editor layout
- connection and environment forms, including explicit draft/save workflows
- connection trees, explorer panels, object context menus, and datastore icons
- query tabs, query toolbar controls, raw editors, and visual query builders
- result renderers for table, document, JSON, key-value, search, graph, raw, schema, plans, profiles, metrics, and history
- interactive result-export dialogs and payload serializers
- Workspace Search, datastore test-suite editors, SQL relationship diagrams, and first-install guide surfaces
- experimental API Server and MCP Server plugins, including setup, status, metrics, logs, and guarded configuration UI
- user-facing guardrail states such as read-only badges, disabled reasons, and operation previews

The shell should remain capability-aware through adapter and experience manifests. Engine-specific labels are fine at the edge of the UI, but behavior should not be scattered across arbitrary engine-name checks.

### Application Layer

The application layer coordinates:

- workspace state, selected activity, active sidebar pane, right drawer, and bottom-panel tab
- connection and environment selection
- explicit query-tab creation, scoped query creation, and closed-tab recovery
- environment variable resolution and sensitive-value redaction
- query execution requests, result paging, result history, and query history
- per-tab execution state, stale-result protection, visible render timing, and concurrent tab execution
- workspace search indexing, closed-tab recovery, and test-suite execution orchestration
- safe edit planning/execution and guarded operation previews
- explorer loading, diagnostics loading, permission inspection, and unavailable-action reasons
- workspace bundle file export/import, encrypted integrity verification, and auto-backup preferences
- API Server and MCP Server plugin preferences, profile selection, token metadata, setup previews, local status, metrics, and logs

Opening a query tab is intentionally a pure editor action. Selecting a connection should not create a tab or open the connection drawer; connection editing is explicit.

### Domain Layer

The shared TypeScript contracts define:

- datastore families, engines, maturity, query languages, and connection modes
- adapter capabilities and result renderer types
- connection profiles, environment profiles, and workspace state
- query tab state, builder state, scoped query targets, and Library nodes
- result payloads, messages, diagnostics, permissions, operation manifests, operation plans, and safe edit requests
- datastore experience manifests for object kinds, object actions, builders, editable scopes, diagnostics tabs, and safety rules
- API Server, MCP Server, Workspace Search plugin, first-install guide, workspace bundle, and test-suite contracts

The shared contracts are the stable bridge between the frontend and Rust host. Prefer additive contract changes when expanding features.

### Adapter Layer

Each datastore integration is isolated behind the Rust adapter contract. A mature adapter can cover:

- manifest and experience metadata
- connection validation and connection-test warnings
- metadata discovery and explorer inspection
- raw query execution or typed request-builder execution
- result normalization and pagination
- safe live data-edit planning/execution where identity is unambiguous
- guarded operation manifests and operation plans for admin/destructive actions
- permission inspection, diagnostics, query plans/profiles, metrics, and cost estimates
- import/export and backup/restore planning
- error normalization and user-facing hints

Datastore-specific code should live under the relevant engine folder whenever practical. Shared family helpers should be used for identifiers, pagination, result builders, guardrails, secret redaction, and operation planning.

### Infrastructure Layer

The Tauri native host and infrastructure modules provide:

- privileged desktop commands and runtime dispatch
- secure secret storage through the OS credential store where available
- workspace persistence, migrations, fixture bootstrap, and local file selection
- encrypted workspace import/export and filesystem access
- logging, redaction, diagnostics, and app locking
- local-only API Server and MCP Server plugin listeners, auth-token verification, setup file backups, and observability payloads
- release, updater, signing, and OS integration hooks
- long-running task execution without freezing the UI

## Workbench Flow

1. A user creates or selects a saved connection and environment.
2. The UI resolves the adapter manifest and datastore experience manifest.
3. A query tab is opened explicitly from a connection/object context menu or tab-strip action.
4. The query window chooses the datastore-owned mode for the active tab, such as raw SQL, MongoDB Query Builder, MongoDB Scripting, Redis Key Browser, Redis Console, or a scoped visual builder.
5. The application layer resolves variables, evaluates read-only/safe-mode guardrails, and dispatches to the Rust runtime.
6. The adapter executes the read request or returns a guarded plan.
7. Results are normalized into renderer payloads and routed to the results workbench.
8. The active tab stays busy until the first visible result render completes.
9. Users can inspect, copy, export through a Save As dialog, page document results, drag document fields into builders, view history/details/messages, or plan safe edits.

## Current Boundaries

The current repo uses:

- `apps/desktop/src` for React workbench code
- `apps/desktop/src/app` for shell composition, state, workbench components, query builders, and result views
- `apps/desktop/src-tauri` for the native host, runtime commands, persistence, security, fixtures, and adapters
- `packages/shared-types` for product contracts, capabilities, catalog entries, runtime payloads, and datastore experiences
- `tests/fixtures` for Docker Compose fixtures, generated env files, and repeatable seed data
- `docs/` for architecture, feature, testing, release, and contributing material

## Naming

The product is **DataPad++**. Repository-safe and package-safe surfaces use `DataPadPlusPlus` or `datapadplusplus`. The current environment variable prefix is `DATAPADPLUSPLUS_`; legacy `DATANAUT_*` and `UNIVERSALITY_*` fallbacks are intentionally retained only for compatibility with older local workspaces and fixtures.
