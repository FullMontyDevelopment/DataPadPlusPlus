# Oracle Support

DataPad++ includes a managed Oracle runtime for Oracle Database 19c and newer. The desktop application can test a real connection, browse live objects, run SQL and PL/SQL, and populate IntelliSense without requiring Oracle Client, SQLPlus, Docker, or a separate .NET installation.

## Connection Modes

The built-in runtime supports service names, SIDs, Easy Connect descriptors, TNS aliases, TCPS, cloud wallets, proxy users, and the administrative roles supported by ODP.NET. Use `TNS Admin Path` when a TNS alias or wallet configuration depends on local Oracle Net files. Unsupported option combinations fail with a specific connection error instead of being silently ignored.

Credentials are sent to the bundled runtime over its private stdin channel and kept in memory. Passwords, wallets, and secret-bearing connection strings are not placed in process arguments, application logs, explorer evidence, or diagnostics.

`Built-in Oracle driver` is the default runtime. `SQLPlus` remains available as an explicit legacy fallback for older databases or specialized Oracle Net configurations. `Preview only` never connects to a database.

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
