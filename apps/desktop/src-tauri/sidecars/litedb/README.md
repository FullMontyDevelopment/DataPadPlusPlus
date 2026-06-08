# DataPad++ LiteDB sidecar

This optional .NET sidecar is the native LiteDB engine bridge used by the LiteDB completion track.

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

The sidecar intentionally exposes read-only datastore operations by default. Guarded document mutations are limited to `InsertDocument`, `UpdateDocument`, and `DeleteDocument`, require `"readOnly": false`, and are expected to be called only after the desktop confirmation gate has produced a sidecar mutation envelope with `_id` evidence requests. `SeedFixture` exists only for the opt-in validator and requires `DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED=1`.

Run the optional real-engine validator with NuGet access enabled:

```powershell
dotnet build apps/desktop/src-tauri/sidecars/litedb/DataPadPlusPlus.LiteDbSidecar.csproj
$env:DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE='1'
npm run fixtures:validate:litedb:dotnet
```
