# Oracle Support

DataPad++ uses a bundled managed Oracle runtime for Oracle Database 19c and newer. It can test connections, browse live objects, run SQL and PL/SQL, perform guarded table transfers, submit Data Pump jobs, and populate IntelliSense without requiring Oracle Client, SQLPlus, Docker, or a separate .NET installation.

> [!CAUTION]
> DataPad++ is pre-release software and should not be used for production workloads. Start with a restricted or read-only Oracle account and verify every generated operation.

## Connections

The managed runtime supports service names, SIDs, Easy Connect descriptors, TNS aliases, TCPS/cloud wallets, proxy users, and supported ODP.NET administrative roles. `TNS Admin Path` supplies Oracle Net configuration when a TNS alias or wallet requires it.

Credentials travel over the sidecar's private stdin channel and remain in memory. Passwords, wallets, and secret-bearing connection strings must not appear in process arguments, logs, Explorer evidence, or diagnostics.

`Built-in Oracle driver` is the default. `SQLPlus` is an explicit legacy fallback for specialized configurations. `Preview only` never connects.

## Runtime Targets

- Windows x64: `win-x64`
- Linux x64: `linux-x64`
- macOS Apple Silicon: `osx-arm64`

The matching self-contained sidecar starts lazily with redirected stdin/stdout and no network listener. A credential-free handshake checks protocol, target platform, managed driver, and runtime health before database work.

Stable startup codes distinguish a missing sidecar, operating-system policy block, and sidecar startup/handshake failure. Explicit **Test Connection** and **Run** requests can retry after a background metadata cooldown. DataPad++ does not replace failed live results with preview data.

## Query Scope And Transactions

The query tab's schema selector is the authoritative completion schema. Database/container scope and the session's current schema provide fallbacks only when no tab schema is selected.

The editor supports SQL, DML, DDL, `MERGE`, transaction control, procedure calls, multi-statement scripts, and slash-terminated PL/SQL blocks. SQLPlus client commands such as `SPOOL`, `HOST`, and substitution variables are rejected by the managed runtime.

Each run uses one Oracle session. Outstanding successful DML commits at the end of the run, failure rolls it back, and explicit `COMMIT` or `ROLLBACK` is honored. Transactions do not remain open across separate runs; normal Oracle implicit commits around DDL still apply.

## Explorer Paging

Oracle metadata remains server-paged and deterministically ordered. Large Tables, Views, Materialized Views, and other paged branches expose **Load more**:

- already-buffered children are revealed before requesting another server page;
- continuation pages merge by exact stable node identity without duplicates;
- quoted identifiers that differ only by case remain distinct;
- a continuation failure preserves the pages already displayed;
- Refresh replaces accumulated pages and resets the cursor.

Current-schema branches use permission-appropriate `USER_*` metadata; other visible owners use `ALL_*` metadata. Restricted access produces an empty/restricted state with Oracle evidence rather than invented objects.

## Progressive IntelliSense

Completion uses a two-phase cursor:

1. table, view, and materialized-view names load in object pages;
2. columns load in larger row pages and merge into the discovered objects.

Pages continue in the background until the selected schema is complete. A page is accepted only when connection, environment, schema, completion mode, and request generation still match. Changing tabs or schema cannot allow stale metadata to replace the active catalog.

If a later page fails, loaded suggestions remain available and the catalog is marked partial. Ctrl/Cmd+Space or schema refresh retries the incomplete catalog. Completion preserves exact Oracle case and quoting, including Unicode, `$`, `#`, mixed-case, and quoted names.

## Transfers And Data Pump

- Local table data uses managed-driver CSV streaming and array binding into an existing empty target after column validation.
- Data Pump backup/restore uses `DBMS_DATAPUMP` and Oracle DIRECTORY objects; the archive remains server-side.
- Schema/table remapping and job progress are represented through guarded native job options.
- RMAN and physical database backup remain unavailable because they require external administrative tooling.

Transfer support is always taken from the current runtime capability manifest and the connected account's permissions. See [Native Datastore Transfers](datastore-transfers.md).

## Safety Boundaries

Environment confirmations apply to writes and destructive statements. Oracle-aware guards classify PL/SQL, procedure calls, dynamic SQL, `SELECT FOR UPDATE`, administration, transfer, and Data Pump requests. Unknown statements fail closed for read-only profiles. DataPad++ never elevates database or operating-system privileges.

Docker is test infrastructure only and is not a user requirement.
