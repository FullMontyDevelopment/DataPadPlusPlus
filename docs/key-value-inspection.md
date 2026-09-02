# Key-Value Inspection

Redis, Valkey, and other compatible key-value surfaces separate fast browsing previews from authoritative full-value reads.

## Browse Keys

Delimiter and search-pattern fields retain focus and draft text while typing. Searching or refreshing is deliberate, so an in-progress `*` pattern or custom namespace delimiter is not replaced by a rerender.

Key rows show only meaningful expansion. Scalar values do not present a redundant expand control; hashes, lists, sets, sorted sets, streams, and supported module values expose type-appropriate members or structures.

## Open A Complete Value

Use the row context menu and choose **Open Value**. The inspector:

- titles the view with the field or key name;
- shows type and byte size as compact inline badges;
- provides **Source** and **Formatted JSON** view labels where JSON formatting is valid;
- uses icon-first copy actions with accessible names and tooltips;
- provides guarded editing when the adapter can prove the key/type target;
- keeps render timing separate from value metadata.

The full-value request reads the authoritative value rather than copying a shortened grid cell. Large values remain subject to explicit safety and transport bounds, but any partial/unsupported response is marked and cannot masquerade as complete.

## Copy And Format

**Copy Value** preserves the authoritative source representation. **Copy Formatted JSON** appears only when the full source parses as JSON and copies its formatted equivalent. Formatting never changes the stored value.

Binary-safe or opaque values use lossless encodings and type metadata. DataPad++ does not guess that arbitrary bytes are text, JSON, a UUID, or another semantic type.

## Edit Safely

Editing requires a writable profile, concrete key, supported native type, matching connection/environment, and no conflicting execution lock. RedisJSON path edits and native member operations use their adapter-owned request shape. Confirmation and before/after evidence apply where required.

Failed execution leaves the displayed value unchanged and reports the sanitized reason.
