/**
 * Authoritative persisted workspace schema version.
 *
 * The Rust build reads this declaration and generates its matching constant so
 * desktop and browser workspaces cannot drift independently.
 */
export const CURRENT_WORKSPACE_SCHEMA_VERSION = 12 as const

/** Existing snapshots were normalized in place rather than through steps. */
export const CONSOLIDATED_LEGACY_WORKSPACE_SCHEMA_VERSION = 11 as const
