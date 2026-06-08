# Development Guide

## Tooling

- Node.js 24+
- npm 11+
- Rust stable for Tauri desktop runs
- Tauri platform prerequisites for your OS
- Windows contributors should install the Visual Studio C++ desktop workload and Windows SDK before expecting `cargo check` or `tauri build` to link successfully

## Workspace commands

From the repo root:

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
npm run tauri:dev
```

Full local validation:

```bash
npm run check:all
```

Native Rust formatting can be checked independently from the Tauri host:

```bash
cd apps/desktop/src-tauri
cargo fmt --check
```

## Current package boundaries

- `apps/desktop`: React workbench, Vite preview, Tauri desktop host, and desktop package scripts
- `packages/shared-types`: shared domain contracts, capability flags, datastore catalog, runtime payloads, and experience manifests
- `tests/fixtures`: Docker Compose profiles, generated env files, and deterministic seed data
- `docs`: feature, architecture, release, testing, and contribution documentation

NPM package names use the `@datapadplusplus/*` scope. The Rust desktop crate is `datapadplusplus-desktop`.

## Coding expectations

- keep shared contracts engine-neutral where possible
- isolate datastore-specific logic inside adapters or family-specific modules
- prefer capability checks over engine-specific UI branching
- keep privileged native operations behind Tauri commands
- redact sensitive data in logs and UI fixtures
- keep query-tab creation separate from connection editing
- keep connection creation as draft state until the user saves
- keep admin/destructive operations plan-first unless an explicit safe execution path exists
- add tests near the component/module being changed instead of growing app-wide tests by default
- split files when it creates durable product boundaries, but do not create tiny abstractions only to satisfy a line count

## Adding a new datastore adapter

1. Add or extend the shared capability and connection contracts if needed.
2. Add or update the datastore catalog and experience manifest.
3. Create the adapter under the relevant datastore directory in `apps/desktop/src-tauri/src/adapters/datastores`.
4. Define validation, metadata, execution, result normalization, permissions, diagnostics, operations, and safe edit behavior.
5. Add UI affordances only for capabilities and experience entries the adapter declares.
6. Add deterministic fixture data or contract mocks when the engine can be tested locally.
7. Cover the new flow with unit, contract, integration, and focused UI tests before exposing it broadly.

Preferred adapter folder shape:

```text
catalog/
connection/
explorer/
query/
builders/
editing/
diagnostics/
operations/
tests/
```

Use fewer folders when the adapter is small. The goal is discoverability, not ceremony.

## Query Builders And Results

Builder-capable tabs should use one query window with datastore-owned toolbar modes. Examples:

- MongoDB: Query Builder, Raw, Scripting
- Redis/Valkey: Key Browser, Console
- SQL engines: raw editor by default, with SELECT builder only when scoped to a table or view

Builder output should stay synchronized with executable query text unless a product flow explicitly marks raw text as diverged. Field drag/drop should use structured field path and sample value metadata from result renderers.

Result renderer changes should preserve the normalized payload contract. Put display-specific state, such as document expansion and inline edit mode, in the result component layer.

## Fixtures

Use the default fixture stack for everyday debugging:

```bash
npm run fixtures:up
npm run fixtures:seed
```

Use profiles only when needed:

```bash
npm run fixtures:up:profile -- search
npm run fixtures:up:profile -- sqlplus
npm run fixtures:up:profile -- redis-stack
npm run fixtures:up:profile -- cache
npm run fixtures:validate:postgres
npm run fixtures:validate:mongodb
npm run fixtures:validate:redis -- --require-stack --require-valkey
npm run fixtures:validate:timescale
npm run fixtures:validate:oracle
npm run fixtures:validate:dynamodb
```

The current env prefix is `DATAPADPLUSPLUS_*`. Legacy prefixes are compatibility fallbacks only.

## Releases

Releases are created through the manual GitHub Actions `Release` workflow. The workflow accepts a semantic version, updates version files, commits `chore: release v<version>`, tags `app-v<version>`, creates a draft GitHub Release, and explicitly uploads draft Tauri artifacts. Release assets include Windows NSIS/MSI installers, Linux deb/rpm/AppImage bundles, macOS Apple Silicon app/DMG bundles, and raw executable archives for each platform. GitHub still shows automatic source-code archives on every release; those are not the desktop installers.

Useful release checks:

```bash
npm run release:test
npm run release:bump -- 0.1.3
npm run release:validate -- 0.1.3
```

Do not hand-edit release version files unless you are intentionally repairing release metadata.
