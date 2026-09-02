# Query Builders And Document Editing

DataPad++ shares value validation and editing behavior where datastores have equivalent semantics, while each adapter retains native serialization and execution.

## Typed Query Values

- Strings use text input and remain strings unless another type is explicitly selected.
- Numbers must be finite; invalid or partial values never fall back to `0`, `null`, or a string.
- Booleans use an explicit true/false selector.
- Dates accept a timezone-bearing ISO-8601 value or date-only value. The optional local picker converts to UTC.
- UUID/GUID input must use canonical `8-4-4-4-12` text.
- MongoDB ObjectIds require 24 hexadecimal characters.
- JSON uses a compact preview and a larger code editor with explicit Validate and Apply actions.
- Every value in `In`, `Not In`, and similar operators is validated. JSON variants require an array.

Invalid drafts remain in the row for correction but block Run, Count, and Use in Query Editor. The last valid generated query is not replaced by an invalid draft.

## Operators Without Values

`Exists`, `Does Not Exist`, `Is Null`, `Is Not Null`, `Has Items`, and `Has No Items` hide both value and type controls. `Has Length` shows one non-negative whole-number input and no type selector.

Array predicates are offered only when the datastore provides a reliable server-side predicate. Supported builders include MongoDB, Cosmos DB NoSQL, DynamoDB filter expressions, PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite, and SQL Server. They are intentionally absent from Elasticsearch/OpenSearch and Cassandra builder surfaces.

`Has No Items` matches an existing empty array. Missing, null, and scalar values do not match. Some native predicates are computed or non-indexed; the builder displays concise performance guidance.

## Nested Groups

Each group owns its `AND` or `OR` join and compiles with explicit parentheses/AST grouping. Child groups cannot leak their join into siblings. Disabled rows are excluded deliberately; invalid enabled rows block compilation instead of disappearing from the generated query.

## SQL Scope

Supported SQL tabs store database/catalog and schema selection in tab scope. The runtime applies supported session/database routing, and generated builder SQL contains only the query. Engines without a safe session-level mechanism keep qualification or connection-level database behavior.

## Shared Document Editing

MongoDB, Cosmos DB NoSQL, LiteDB, and ArangoDB use the shared Document results editor where the adapter provides complete mutation identity.

- **Add Field** targets an object/root or a scalar's object parent and never arrays.
- **Remove Field** applies only to object properties; root removal remains **Delete Document**.
- Duplicate, empty, unsafe dotted/`$`-prefixed, reserved, and protected field names are rejected.
- Add uses an explicit `add-field` operation so an existing value cannot be overwritten.
- No result changes locally until the datastore returns authoritative evidence.

Typed editors preserve datastore-native wrappers. MongoDB/LiteDB Extended JSON dates, object ids, numbers, UUID/GUID values, binary, timestamps, regex, and compound values remain lossless. Ordinary Cosmos or Arango strings are not reclassified heuristically.

## Raw JSON

**View Raw JSON** displays pretty, searchable JSON. **Edit Raw JSON** is capability-gated and provides Validate, Save, and Cancel:

- every edit invalidates previous validation;
- Save remains disabled until current text passes explicit validation;
- root edits must produce an object;
- field edits may produce any valid JSON value;
- validation checks native Extended JSON shapes, immutable fields, target identity, partition/shard keys, concurrency, and size limits;
- summarized, lazy, truncated, or unsupported data is hydrated losslessly before editing or rejected.

Server responses provide authoritative before/after documents so Cosmos `_etag` and ArangoDB `_rev` remain current.
