# Security And Safety

DataPad++ is pre-release software that can hold credentials and issue live datastore operations. Security and safety are architectural requirements, but they do not make the application suitable for production workloads.

> [!CAUTION]
> Do not use DataPad++ for production workloads or as the only access, backup, or recovery path for important data. Unknown defects may issue incorrect operations, interrupt services, or lose data. Begin with disposable, local, or read-only systems and keep independent backups.

## Secret Boundary

- Store secret values in the operating-system credential vault and persist only DataPad++-owned references.
- Treat a complete connection string as one opaque secret. Do not parse, normalize, deconstruct, reconstruct, or log it.
- Resolve secrets only in the privileged backend for testing or execution, then interpolate environments in memory.
- Leave secret drafts out of workspace JSON, browser storage, diagnostics, errors, process arguments, generated client configuration, and secret-free exports.
- Browser preview keeps secrets in memory only.
- Clear plaintext buffers and form drafts as soon as practical after save, test, transfer, import, export, or close.

Editing a connection with a blank secret field preserves the existing value. Replacing, changing mode, or deleting a connection updates vault references transactionally. Migration errors identify the connection name and datastore without exposing the connection string.

## Connection Health

Connection health is session-only and evidence-based:

- startup performs no automatic connection sweep and displays no placeholder status;
- manual tests show checking and then the authoritative result;
- successful Explorer, query, metrics, object, or key-value operations mark the connection/environment as connected;
- authentication, credentials, connectivity, TLS, DNS, and timeout failures can mark it as an issue;
- validation, syntax, cancellation, permission-limited metadata, and rendering failures do not imply connection failure;
- editing/deleting a connection or environment invalidates only related entries.

## Guardrails

- Read-only profiles fail closed for writes and unclassified statements.
- Environments carry persistent risk color, read-only rules, variables, and confirmation requirements.
- Global Safe Mode can add workspace-wide confirmation without replacing environment rules.
- Stable identity is required for live edits: primary keys, document ids, complete partition/shard keys, concurrency tokens, or concrete cache keys.
- Running/queued operations lock incompatible edits, transfers, tab movement, workspace switching, and shutdown paths.
- Destructive, costly, administrative, import, backup, and restore actions show scope, permissions, impact, and confirmation text before execution.
- Ambiguous writes are verified when possible and never reported as success without authoritative evidence.

## Results, Redaction, And Logging

Display redaction protects values that are confirmed credential material or originate from secret-backed fields. It must not replace ordinary result values merely because a field name resembles a secret.

Logs and diagnostics may record operation type, adapter, duration, status, sanitized error class, counts, and byte sizes. They must not record credentials, complete connection strings, query text, returned values, local paths, signed storage URIs, encrypted passphrases, or secret inventory contents.

Full-value inspection uses a dedicated bounded request contract and keeps preview truncation distinct from authoritative copied data. Unsupported or partial values remain visibly marked instead of being presented as complete.

## Workspace Bundles And Migration

- `schemaVersion`, cross-window `workspaceRevision`, and encrypted bundle `formatVersion` are independent.
- Workspace migration creates recovery state, mutates a clone, validates, and durably persists before removing superseded vault entries.
- Export is encrypted and excludes secrets by default.
- Secret-inclusive export requires every selected secret to resolve; partial bundles are rejected.
- Import validates envelope, KDF bounds, authenticated metadata, schema version, decompressed size, and decrypted payload before writing secrets or state.
- Imported secrets receive fresh DataPad++-owned references and cannot overwrite arbitrary vault accounts supplied by a bundle.
- Replace/restore operations preserve rollback data until workspace and vault work have committed.

## Datastore Transfers

- Frontends receive opaque selection tokens rather than full local paths.
- Temporary outputs are renamed only after successful completion.
- Imports default to fail-on-conflict; no silent overwrite, upsert, or guessed schema creation is permitted.
- Server/cloud destinations use the current connection identity, existing repository/directory/stage, or credential-free reference. Credentials and signed URLs are excluded from commands and journals.
- Resumable journals store sanitized job identifiers and states, not data, queries, credentials, or sensitive URIs.
- Native backup is advertised only when a supported API-level mechanism exists.

See [Native Datastore Transfers](../datastore-transfers.md).

## Local API And MCP Plugins

Optional local server plugins are disabled by default. MCP binds to loopback, validates expected host/origin behavior, requires scoped bearer authentication, stores only credential verifiers, and limits tools to explicitly enabled contexts. API Server profiles expose selected resources or saved queries, not the entire workspace by implication.

Generated project exports use environment-variable references rather than copying DataPad++ secret values. Automatic MCP client setup previews its target, creates a backup, and writes token environment references rather than raw tokens.

## Datastore Security Checks

Vulnerability evidence is kept separate from posture evidence. Posture probes are bounded and read-only, permission failures become unknown results, and evidence is sanitized. Scans must not change datastore settings, create objects, invoke provider control planes, or persist raw probe payloads.

## Dependency Exceptions

Dependency advisories must be evaluated against actual reachability and upstream fixes. Do not force unsupported dependency majors or downgrade security-sensitive editor/runtime components solely to produce an empty audit report. Document deliberate holds with their peer, runtime, or platform constraint.
