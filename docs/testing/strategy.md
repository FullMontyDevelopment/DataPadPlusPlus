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

Profiles such as `cache`, `redis-stack`, `sqlplus`, `analytics`, `search`, `graph`, `widecolumn`, `oracle`, and `cloud-contract` can be enabled when testing those families. These tests must not be required by default CI.

The PostgreSQL reference-engine fixture evidence path is:

```powershell
npm run fixtures:up
npm run fixtures:seed
npm run fixtures:validate:postgres
```

That validator checks seeded relational volume, catalog/security/extension visibility, `pg_stat_activity`, `pg_locks`, `pg_stat_user_tables`, session action primitives, rendered `EXPLAIN ANALYZE` JSON profile output, routine call/procedure primitives, row-edit before/after evidence, permission-denied guarded writes with a temporary read-only user, table import/export command primitives, and bounded logical backup evidence. Full `pg_dump`/`pg_restore` execution remains outside the scoped native-complete claim unless a later release promotes that workflow with explicit live guardrails.

The MongoDB reference-engine fixture evidence path is:

```powershell
npm run fixtures:up
npm run fixtures:seed
npm run fixtures:validate:mongodb
```

That validator checks seeded catalog volume, large-document export primitives, collection import/export command primitives, duplicate-key and validator failure evidence, permission-denied diagnostics with a temporary read-only user, and before/after evidence for index hiding, validator updates, and user management.

The Redis reference-engine fixture evidence path is:

```powershell
npm run fixtures:up:profile -- redis-stack
npm run fixtures:up:profile -- cache
npm run fixtures:seed:all
npm run fixtures:validate:redis -- --require-stack --require-valkey
```

That validator checks Redis and Valkey core key/stream-group seeds, Valkey core key-file export/import command primitives, TTL behavior, permission-denied guarded writes, and large key-file primitives, plus Redis Stack JSON, TimeSeries, probabilistic module, and vector-set seeds when the selected Redis Stack image exposes vector commands. Add `--require-vector` only with a Redis Stack image that exposes `VADD`; otherwise vector-set live fixture evidence is recorded as an image-dependent optional extension outside the default gate.

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
