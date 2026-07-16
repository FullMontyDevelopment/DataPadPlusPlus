# Oracle Support

DataPad++ includes a managed Oracle runtime for Oracle Database 19c and newer. The desktop application can test a real connection, browse live objects, run SQL and PL/SQL, and populate IntelliSense without requiring Oracle Client, SQLPlus, Docker, or a separate .NET installation.

## Connection Modes

The built-in runtime supports service names, SIDs, Easy Connect descriptors, TNS aliases, TCPS, cloud wallets, proxy users, and the administrative roles supported by ODP.NET. Use `TNS Admin Path` when a TNS alias or wallet configuration depends on local Oracle Net files. Unsupported option combinations fail with a specific connection error instead of being silently ignored.

Credentials are sent to the bundled runtime over its private stdin channel and kept in memory. Passwords, wallets, and secret-bearing connection strings are not placed in process arguments, application logs, explorer evidence, or diagnostics.

`Built-in Oracle driver` is the default runtime. `SQLPlus` remains available as an explicit legacy fallback for older databases or specialized Oracle Net configurations. `Preview only` never connects to a database.

## Runtime And Platform Support

Each desktop release contains one self-contained Oracle runtime matching its platform:

- Windows x64: `win-x64`
- Linux x64: `linux-x64`
- macOS Apple Silicon: `osx-arm64`

The managed provider does not require Oracle Client. DataPad++ starts the matching runtime lazily, communicates over redirected stdin/stdout pipes with no local network listener, and keeps one healthy process available until the app exits. Windows launches it with no console window. Linux and macOS launch it directly without a shell or terminal emulator. A credential-free health handshake verifies the protocol, .NET runtime, managed driver, target platform, and Windows console state before any database request is sent.

Current built-in support targets Oracle Database 19c+ on Windows x64, the supported 64-bit Linux release platforms, and macOS ARM64 14.7+. Intel macOS and Linux ARM64 are not release targets in this support pass. See Oracle's [ODP.NET Core system requirements](https://docs.oracle.com/en/database/oracle/oracle-database/26/odpnt/InstallSystemRequirements.html) and [installation documentation](https://docs.oracle.com/en/database/oracle/oracle-database/26/odpnt/InstallODPCore.html).

### Managed-Device Troubleshooting

Local startup failures are reported with a stable code:

- `oracle-sidecar-not-found`: the matching runtime is missing from the installation.
- `oracle-sidecar-blocked`: operating-system or endpoint policy denied execution.
- `oracle-sidecar-startup-failed`: the process started but exited, timed out, or failed its health handshake.

After a local startup failure, background explorer and IntelliSense attempts pause for 60 seconds. **Test Connection** and **Run** bypass that cooldown so an explicit retry is always available. Preview-only and SQLPlus profiles do not start managed metadata or IntelliSense work. DataPad++ does not silently replace blocked live results with preview data.

Corporate policy is not bypassed. Reinstall when the runtime is missing, or ask IT to allow the signed `datapadplusplus-oracle-runtime` shipped with DataPad++. Preview-only remains available when local execution cannot be approved. An unreachable database returns its Oracle/network error through the already healthy runtime and does not cause runtime restart loops.

## Queries And Transactions

The editor supports `SELECT`, `WITH`, DML, DDL, `MERGE`, transaction control, procedure calls, and PL/SQL blocks. Multi-statement scripts and slash-terminated PL/SQL are supported. SQLPlus client commands such as `SPOOL`, `HOST`, and substitution-variable commands are rejected because the built-in runtime executes database statements, not SQLPlus scripts.

Each Run, selection, or script uses one Oracle session. Successful outstanding DML is committed at the end of that run, pending work is rolled back if a statement fails, and explicit `COMMIT` or `ROLLBACK` statements are honored. Transactions do not stay open across separate runs. Oracle's normal implicit commits around DDL still apply.

Result limits are enforced while rows are read; DataPad++ does not rewrite arbitrary user SQL. Truncated results are marked, and LOB and binary values use bounded reads. Table, JSON, raw status, affected-row, multiple-result, DBMS output, explain, and profile payloads use the normal Results views.

## Explorer And IntelliSense

The database branch represents the selected Oracle service or PDB and shows current-schema categories beneath `Databases/<service>`. The separate Schemas branch lists other owners visible to the authenticated account.

Explorer metadata comes from permission-appropriate `USER_*` and `ALL_*` views. It covers tables and their columns, constraints, indexes, and triggers; views and materialized views; packages and routines; procedure/function arguments; types; sequences; synonyms; database links; external tables; and JSON collections. Restricted dictionary access produces an empty or restricted state with the Oracle error code; DataPad++ does not invent objects.

IntelliSense loads built-ins immediately and refreshes automatically when live Oracle metadata arrives. Oracle completions understand owners, packages, routines, and Oracle row limiting, and omit incompatible generic suggestions such as `LIMIT`, `OFFSET`, and `date_trunc`.

## Safety Boundaries

Environment confirmations apply to writes and destructive statements. Oracle-aware guards classify PL/SQL, procedure calls, dynamic SQL, `SELECT FOR UPDATE`, and administrative statements. Unknown statements fail closed for read-only profiles. The desktop UI, API server, and MCP server all use the same backend guardrails and the Oracle account's existing database permissions; DataPad++ never elevates operating-system or database privileges.

Data Pump, RMAN, and other external Oracle administration utilities remain preview-first unless a separately guarded workflow explicitly promotes them. Docker is used only by repository integration tests and is never a user requirement.
