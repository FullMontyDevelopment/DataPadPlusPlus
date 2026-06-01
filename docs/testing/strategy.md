# Testing Strategy

DataPad++ should treat testing as a product feature because connection handling, secret management, and production safeguards are high-trust workflows.

## Test layers

### Unit tests

Cover:

- environment variable resolution
- capability-driven UI selection
- connection configuration validation
- result renderer selection
- result export serializers and save-dialog command routing
- Library migration and save-target transformations
- query-builder generation and raw synchronization
- safe edit planning helpers
- operation-plan guardrails
- SQL diagnostic hints
- release version bump and workflow validation scripts

### Integration tests

Cover:

- query execution orchestration
- import and export flows
- adapter normalization behavior
- secret storage boundaries
- production guardrail decisions
- explorer and scoped query creation flows
- bottom-panel tab validation, including Results, Messages, Query History, and Details
- result paging and virtualization guardrails
- per-tab concurrent execution, stale completion handling, and visible render timing
- workspace bundle export/import integrity, optional secret inclusion, and auto-backup rotation
- permission inspection and disabled-action rendering
- dependency-free adapter contract behavior

### End-to-end tests

Cover:

- connection creation and testing
- opening explorer objects into tabs
- running SQL, Mongo, and Redis workflows
- switching result renderers
- saving and reopening work
- query builder toolbar modes
- document-field drag-and-drop into builder sections
- safe inline document edits where supported
- environment switching and read-only behavior

## CI gates

Every pull request should run:

- lint
- unit tests
- dependency-free integration and contract tests
- production build
- release workflow/script tests
- Rust format, check, test, and clippy

The default GitHub CI path must not require Docker, local database ports, desktop WebDriver, cloud credentials, or live datastore services. Fixture-backed adapter tests and desktop E2E remain available through local/manual commands when a developer explicitly opts into them.

## Current Commands

Use the broad local check when changing contracts, runtime, adapters, releases, or app-wide UI:

```bash
npm run check:all
```

Useful focused checks:

```bash
npm run lint
npm run test
npm run build
npm run release:test
npm run ci:workflow:test
npm run rust:fmt
npm run rust:check
npm run rust:test
npm run rust:clippy
```

## Fixture-Gated Tests

Container-backed tests are intentionally opt-in:

```powershell
npm run fixtures:up
npm run fixtures:seed
$env:DATAPADPLUSPLUS_FIXTURE_RUN='1'
npm run rust:test
```

Profiles such as `cache`, `sqlplus`, `analytics`, `search`, `graph`, `widecolumn`, `oracle`, and `cloud-contract` can be enabled when testing those families. These tests must not be required by default CI.

## Coverage Expectations

Feature work should add tests near the product slice being changed:

- connection sidebar tests for connection menus, grouping persistence, icons, and create/save behavior
- environment tests for clone/save visibility and risk/safe-mode rules
- query-builder tests for filters, groups, enable/disable toggles, projections, sort, paging inputs, drag/drop, and raw output
- result tests for table rendering, document trees, paging, type badges, double-click editing, copy/export, runtime footer, and history tabs
- adapter contract tests for manifests, experience manifests, explorers, operations, permissions, diagnostics, and payload normalization
- guardrail tests for read-only mode, production safe mode, missing primary keys, scan/cost warnings, and destructive preview-only behavior
- datastore-specific query guard tests for native read surfaces and preview-only admin commands, such as CockroachDB `SHOW JOBS` versus `BACKUP` or `EXPLAIN ANALYZE`

Do not push all new coverage into `App.test.tsx` by default. Use focused component or module tests when behavior belongs to a specific slice.
