# DataPad++ LiteDB sidecar

This bundled, self-contained .NET helper is the native LiteDB engine bridge. Releases include it on Windows x64, Linux x64 and macOS ARM64; end users do not need .NET installed. Run `npm run litedb:sidecar:ensure` in a development checkout (also run by the desktop hooks). Explicit runtime overrides are retained for custom deployments.

The desktop runtime sends a single JSON envelope on stdin and expects a single JSON envelope on stdout:

```json
{
  "engine": "litedb",
  "protocolVersion": 1,
  "databasePath": "C:/data/app.db",
  "operation": "Find",
  "request": { "collection": "products", "limit": 51 },
  "rowLimit": 50,
  "readOnly": true
}
```

Successful responses use `{ "ok": true, "response": { ... } }`. Failures use `{ "ok": false, "code": "...", "message": "..." }`.

`CreateDatabase` initializes a new file without overwriting; `TestConnection` opens an existing file read-only. `ListCollections`, `ListIndexes` (one collection or all collections), and `GetMetadata` power the Explorer with real engine data. Metadata includes collection/document/index counts and native pragmas, and never creates a missing database. Collection lists are ordered and paged by the Rust adapter. `SampleSchema` remains explicitly sample-based.

The sidecar intentionally exposes read-only datastore operations by default. Guarded document mutations are limited to `InsertDocument`, `UpdateDocument`, and `DeleteDocument`, require `"readOnly": false`, and are expected to be called only after the desktop confirmation gate has produced a sidecar mutation envelope with `_id` evidence requests. `ValidateEncryptedFile` performs a password-backed open/read probe and returns redacted encrypted-file evidence for the opt-in validator. `ExportCollection` writes bounded JSON/NDJSON collection exports from a read-only envelope, while `ImportCollection` performs insert-only JSON/NDJSON collection imports from a confirmed non-read-only envelope with before/after count evidence. File-storage workflows include read-only `ListFiles`/`ExportFile` plus confirmed `ImportFile`/`DeleteFile` mutations with concrete file IDs, local path checks, overwrite guards, and before/after metadata evidence. Guarded management operations are limited to `EnsureIndex`, `DropIndex`, and `DropCollection`, require `"readOnly": false`, and return before/after index or collection evidence. `BackupDatabase` acquires the LiteDB writer lock, checkpoints, copies to a temporary sibling, reopens and verifies the copy, and atomically renames it without overwriting. `RestoreDatabase` validates an exact backup with the configured password and restores it into a new isolated file using the same verified-copy flow. `SeedFixture` exists only for the opt-in validator and requires `DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED=1`.

Run the optional real-engine validator with NuGet access enabled:

```powershell
npm run litedb:sidecar:test
npm run rust:test:litedb
dotnet build apps/desktop/src-tauri/sidecars/litedb/DataPadPlusPlus.LiteDbSidecar.csproj
$env:DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE='1'
npm run fixtures:validate:litedb:dotnet
```

The xUnit project exercises the actual stdin/stdout protocol process, sanitized typed errors, guarded document mutations with native LiteDB values, and JSON/NDJSON collection round trips. It runs in the normal local and GitHub Actions `check:all` gate; the broader validator remains opt-in because it also exercises fixture-specific workflows.
