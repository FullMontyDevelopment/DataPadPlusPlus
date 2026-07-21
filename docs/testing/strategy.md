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
- workspace search indexing, filters, and result routing
- API Server and MCP Server profile normalization, disabled reasons, token metadata, and generated setup snippets
- Library migration and save-target transformations
- query-builder generation and raw synchronization
- test-suite JSON parsing, visual editor helpers, and assertion normalization
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
- API Server resource discovery, custom endpoint parameter handling, project-export request shaping, and metrics/log routing
- MCP Server token creation/deletion, setup preview behavior, local-only status, and metrics/log routing
- Workspace Search opening behavior for connections, Library items, tabs, and recently closed tabs
- test-suite execution orchestration, cancellation, and environment propagation
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
- Workspace Search can recover saved work and open tabs without losing context
- API Server and MCP Server remain opt-in, local-only, and observable from their workspaces
- test suites can be opened, edited, run, and cancelled from a saved Library item

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

Use the faster development gate during normal iteration. It retains the full frontend test suite but skips the production bundle, Rust tests, and all-target Clippy compilation:

```bash
npm run check:fast
```

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

The TimescaleDB optional fixture evidence path is:

```powershell
npm run fixtures:up:profile -- sqlplus
npm run fixtures:seed:all
npm run fixtures:validate:timescale
```

That validator checks TimescaleDB extension/version visibility, seeded hypertable and chunk catalog metadata, seeded metric volume, hypertable row-edit before/after evidence with `RETURNING` snapshots, restricted catalog visibility, permission-denied guarded writes with a temporary read-only role, continuous aggregate plus policy/job boundary evidence, compressed chunk, aggregate lag, Toolkit variant, bounded file-copy, and failed-job diagnostic evidence through transient `fixture_timescale_*` objects. Live TimescaleDB policy/file execution remains preview-first unless a later slice promotes those workflows with explicit guardrails.

The Oracle optional fixture evidence path is:

```powershell
npm run oracle:sidecar:prepare
dotnet test apps/desktop/src-tauri/sidecars/oracle/tests/DataPadPlusPlus.OracleSidecar.Tests.csproj --configuration Release
npm run fixtures:up:profile -- oracle
npm run fixtures:seed:all
npm run fixtures:validate:oracle
```

The managed-sidecar suite checks the credential-free health protocol, target-platform metadata, Windows console state, statement splitting, read-only classification, service/SID/TNS/Easy Connect descriptor construction, and secret-safe error handling. Release jobs publish and execute the native `win-x64`, `linux-x64`, or `osx-arm64` single-file runtime before Tauri packaging, verify Unix execute permissions, and verify macOS sidecar signing when signing is enabled. The optional Oracle Free fixture checks seeded relational volume, live managed-driver metadata and SQL/PLSQL behavior, dictionary/security/storage metadata, DBMS_XPLAN plan output, SQL Monitor visibility or permission-boundary evidence, PL/SQL package source and compile diagnostics, row identity and DML `RETURNING` primitives, bounded legacy SQLPlus export/import evidence, restricted dictionary denial evidence, and Data Pump/RMAN preview boundary wording through transient `fixture_oracle_*` objects. Desktop Oracle uses the bundled managed runtime by default, with SQLPlus available as an explicit legacy fallback. Docker is test infrastructure only; the released desktop application bundles its own managed Oracle runtime.

The Cosmos DB emulator optional fixture evidence path is:

```powershell
npm run fixtures:up:profile -- cosmosdb
npm run fixtures:seed:all
npm run fixtures:validate:cosmosdb
```

That validator checks the Microsoft Linux vNext Cosmos DB emulator health endpoint, seeded `datapadplusplus` database, `accounts`, `products`, `orders`, and `order_events` containers, and query evidence for seeded product/order documents. The emulator fixture is separate from the lightweight cloud-contract Cosmos DB mock so fast contract tests can keep using the mock while emulator-specific work can validate against the real local gateway and Data Explorer.

The DynamoDB Local optional fixture evidence path is:

```powershell
npm run fixtures:up:profile -- cloud-contract
npm run fixtures:seed:all
npm run fixtures:validate:dynamodb
```

That validator checks seeded table volume, table/key/GSI/TTL metadata through a transient `fixture_dynamodb_contract` table, consumed-capacity payloads, Query, GetItem, PartiQL read evidence, conditional item-edit before/after evidence with `attribute_exists` and `attribute_not_exists`, and backup/import-export local boundary evidence. The desktop adapter now has deterministic SigV4-shaped local/endpoint-override request evidence and diagnostics disabled reasons.

The DynamoDB AWS cloud optional validation path is:

```powershell
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE = '1'
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_REGION = 'us-east-1'
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE = '<optional-table-name>'
npm run fixtures:validate:dynamodb:cloud
```

The cloud validator resolves environment, shared-profile, STS AssumeRole, web identity, ECS task, or EC2 metadata AWS credentials, signs DynamoDB, STS, CloudWatch, and IAM calls with AWS4-HMAC-SHA256, and checks STS identity, `ListTables`, `DescribeLimits`, optional table metadata, optional CloudWatch metrics, and optional IAM simulation. It is excluded from default CI and exits as skipped unless `DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE=1` is set. Use `DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER=assume-role`, `web-identity`, `ecs-task`, or `ec2-instance` with the documented role/token/metadata variables to validate temporary providers. Table, CloudWatch, IAM, and temporary-provider failures can be made strict with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_TABLE=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_CLOUDWATCH=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_IAM=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ASSUME_ROLE=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_WEB_IDENTITY=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ECS_TASK=1`, and `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_EC2_INSTANCE=1`; S3 import/export and backup execution remain preview-first.

The Elasticsearch/OpenSearch optional fixture evidence path is:

```powershell
npm run fixtures:up:profile -- search
npm run fixtures:seed:all
npm run fixtures:validate:search
```

That validator checks seeded `products` and `orders` index volume, mappings, aggregation/profile responses, explicit-id document edit before/after evidence, slow-log settings, node search/indexing stats, shard/allocation diagnostic boundaries, bounded `_search` export plus `_bulk` import primitives through transient `fixture-search-contract-*` and `fixture-search-import-*` indexes, and OpenSearch SQL, ISM, security, and Performance Analyzer plugin boundaries. Desktop file/cloud import-export, snapshot execution, production cloud auth, managed SigV4/IAM execution, OpenSearch SQL plugin execution, Performance Analyzer dashboards, and broader admin execution remain outside the scoped search native-complete claims unless later promoted with explicit guardrails.

The DuckDB optional fixture evidence path is:

```powershell
npm run fixtures:validate:duckdb
```

That validator runs a focused Rust adapter integration test against a temporary `.duckdb` file created by the bundled DuckDB runtime. It checks local-file read SQL, EXPLAIN, profile, catalog explorer roots, table inspection payloads, diagnostics templates, write SQL guard failures, plan-only file import boundaries, guarded CSV export/import execution, backup-folder execution, database-file preflight/read-only guard evidence, lock-boundary evidence for filesystem read/write and DuckDB open probes, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight for `schema.sql`, `load.sql`, detected formats, file counts, bytes, target write/open readiness, and explicit restore/admin/extension execution-boundary evidence for scoped-out destructive `IMPORT DATABASE`, admin/DDL, and extension execution. Docker is not required. Extension-loaded live JSON/Parquet execution and any promoted local OLAP mutation/admin/extension execution remain outside the scoped DuckDB native-complete evidence until later promoted with explicit guardrails.

The LiteDB optional fixture evidence path is:

```powershell
npm run fixtures:validate:litedb
```

That validator runs focused Rust unit tests against temporary `.db` files. It checks local-file read/write open preflight, read-only write blocking, password/encryption posture, lock-boundary metadata, configured sidecar read-dispatch through both a deterministic fixture-sidecar token and a spawned local sidecar-process fixture, bounded response normalization, process open-failure mapping, timeout clamps, redacted failure output, and the LiteDB planner's sidecar-shaped document CRUD contracts. Docker and a real .NET LiteDB engine sidecar are not required for the default gate.

The optional real LiteDB engine sidecar validator is:

```powershell
dotnet build apps/desktop/src-tauri/sidecars/litedb/DataPadPlusPlus.LiteDbSidecar.csproj
$env:DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE='1'
npm run fixtures:validate:litedb:dotnet
```

It creates temporary LiteDB databases through the .NET sidecar, validates collection listing, bounded reads, index metadata, guarded full-document insert/update/delete, before/after reads, read-only mutation blocking, `_id` mismatch blocking, missing-file error mapping, encrypted-file correct-password open/read evidence, wrong-password failure evidence, JSON collection export/import execution, overwrite blocking, read-only import blocking, post-import reads, file-storage import/export/delete with list and post-delete checks, guarded index create/drop, `_id` index drop blocking, guarded collection drop, post-drop collection listing, and secret/path redaction. Packaged sidecar distribution and exclusive writer-lock validation remain outside this checkpoint until a later LiteDB slice promotes them with explicit guardrails.

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
