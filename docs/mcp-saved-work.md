# Saved queries and tests through MCP

DataPad++ is pre-release software. Use disposable or read-only systems, not production workloads.

## Finding saved work

Grant `library:read`, then call `datapad_list_saved_queries` or `datapad_list_test_suites` with `{}`. Lists come from the Library, including migrated legacy saved work. They do not require Workspace Search. Queries include scripts; definitions are retrieved separately with `datapad_get_saved_query` or `datapad_get_test_suite` using the returned `workspaceId` and `itemId`.

Redis/Valkey key-browser layouts can be inspected and edited, but are not executable query commands. Save a raw Redis/Valkey command for MCP execution. Query-producing visual builders use the same compiler as the application.

Lists support `name`, `kind`, `limit` (1–100), and `cursor`. Cursor pages are invalidated when the workspace changes; restart the listing. `datapad_search_workspace` remains literal keyword search, not wildcard listing. Its supported types are `connection`, `folder`, `query`, `script`, `test-suite`, `library-item`, `open-tab`, and `closed-tab`. Unknown filters produce errors instead of misleading empty results.

## Permissions

New scopes are not added to existing tokens and are unchecked when creating a token:

| Scope | Access |
| --- | --- |
| `library:read` | Saved definitions throughout the active workspace; no vault resolution |
| `library:write` | Update existing definitions; not datastore execution |
| `query:read` | Read-only execution on allowlisted targets |
| `query:write` | Permit potentially mutating saved-item execution, subject to guardrails |
| `tests:run` | Plan/run test suites; query scopes still apply to every step |

Library permissions apply across the active workspace. Connection/environment allowlists govern datastore access, not Library discovery. Reconnect after switching workspaces. Server profiles and tokens belong to the selected workspace.

## Editing

Call `datapad_update_saved_query` or `datapad_update_test_suite` with `workspaceId`, `itemId`, `expectedRevision` from the get response, and a `changes` object. Allowed changes are `name`, `summary`, `tags`, and the item's relevant content: `queryText`, `scriptText`, `queryViewMode`, `builderState`, or `testSuite`.

Identity, parent folder, connection, environment, SQL scope, and test target bindings cannot be changed. Conflicting unsaved tabs, running items, stale revisions, malformed content, and redacted-field replacements are rejected without changing the original. Clean linked tabs refresh without changing their selection or window. Saving metadata does not execute a query.

Visual-builder changes use the same codecs and serializers as the UI. Supply the complete `builderState`, including IDs, typed values and groups; never construct `lastAppliedQueryText` yourself. The server recompiles it. To edit a builder as text, explicitly set `queryViewMode` to `raw`; its builder draft is retained.

## Planning and running

1. Read the saved definition and revision.
2. Call `datapad_plan_saved_query_run` or `datapad_plan_test_suite_run` with its workspace/item/revision. For an unbound query, provide `environmentId` explicitly (empty means no environment). Suites optionally accept `caseId`.
3. Review the target, `mayWrite`, blockers, and `requiredConfirmationText`. Never execute a blocked plan or supply confirmation without the user's authorization.
4. Call `datapad_run_saved_query` or `datapad_run_test_suite` with `planId` and any explicitly authorized `confirmationText`.
5. Poll `datapad_get_run` with `runId`. Use `datapad_cancel_run` to request cancellation.

Plans expire after five minutes and are single-use. Runs execute the saved revision, not unsaved drafts. Test execution supports PostgreSQL, SQLite, MongoDB, Redis, Valkey, and DynamoDB with the Datastore Tests plugin enabled. Every setup, execution, and teardown step is checked. Unsupported step types and providers remain unavailable.

The existing `datapad_run_query` tool remains read-only, even for tokens with write permission. Read-only connections, environment restrictions, confirmations, and application locks are never bypassed. Background results are memory-only, token-owned, redacted, and size bounded. Run retention is 15 minutes with a 100-run ceiling. Cancellation is not rollback; interrupted writes and incomplete cleanup require verification before retrying.

## Implementation and validation

Pure TypeScript builder logic lives in `packages/query-compiler/src`. The desktop imports it directly; Rust executes the committed generated bundle in the existing QuickJS runtime with no host APIs, a 64 MiB memory budget and a five-second compiler deadline. Run `npm run query-compiler:generate` after compiler or shared-type changes. `npm run query-compiler:check` and repository quality tests verify generated artifacts are current; standalone Cargo builds need no Node runtime.

The frontend and actual embedded QuickJS compiler run the same 39 regression vectors, covering every query-producing builder family, SQL dialects, typed MongoDB values, nested filter groups and array predicates. The native `npm run e2e:desktop:mcp` suite uses a disposable workspace and SQLite fixture to verify real loopback HTTP authentication, discovery, editing, persistence, permissions, cancellation and workspace switching. The Live Fixture Validation workflow additionally runs PostgreSQL, MongoDB, Redis, Valkey and DynamoDB suites sequentially. These tests never use your saved connections or OS-vault credentials.
