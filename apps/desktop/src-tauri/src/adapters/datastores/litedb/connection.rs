use super::super::super::*;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

pub(super) async fn test_litedb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let path = litedb_file_path(connection);
    let preflight = litedb_local_file_preflight(connection, false);
    let mut warnings = vec![
        "LiteDB is a .NET embedded document database; live file access is routed through a sidecar bridge in a later execution pass."
            .into(),
        "This adapter builds bridge requests, metadata, diagnostics, and guarded mutation plans without requiring ORM credentials."
            .into(),
    ];
    if !path.is_empty() && !preflight["exists"].as_bool().unwrap_or(false) {
        warnings.push(format!(
            "LiteDB file `{path}` does not exist yet; create/open is operation-plan preview only in this phase."
        ));
    }
    if preflight["encryptionBoundary"]["passwordConfigured"]
        .as_bool()
        .unwrap_or(false)
    {
        warnings.push(
            "LiteDB password material is configured and redacted; encrypted-file validation remains sidecar-gated."
                .into(),
        );
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "LiteDB adapter accepted {} as a bridge-contract profile.",
            connection.name
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: Some(path),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(crate) fn litedb_local_file_preflight(
    connection: &ResolvedConnectionProfile,
    write_intent: bool,
) -> Value {
    let database_path = litedb_file_path(connection);
    let path = Path::new(&database_path);
    let file_kind = litedb_file_kind(&database_path);
    let metadata = (file_kind == "local-file")
        .then(|| fs::metadata(path).ok())
        .flatten();
    let exists = metadata.is_some();
    let parent_exists = litedb_parent_exists(path);
    let disk_read_only = metadata
        .as_ref()
        .map(|metadata| metadata.permissions().readonly())
        .unwrap_or(false);
    let read_probe = litedb_read_probe(path, file_kind, exists);
    let write_probe = litedb_write_probe(
        path,
        file_kind,
        exists,
        connection.read_only,
        disk_read_only,
    );
    let encryption_boundary = litedb_encryption_boundary(connection);
    let sidecar_execution_boundary = litedb_sidecar_execution_boundary(write_intent);
    let lock_boundary = litedb_lock_boundary(
        &read_probe,
        &write_probe,
        connection.read_only,
        disk_read_only,
        write_intent,
    );

    json!({
        "databasePath": database_path,
        "fileKind": file_kind,
        "pathResolution": {
            "source": "connection-profile",
            "normalizedPath": database_path,
            "parentExists": parent_exists,
            "requiresAbsolutePathBeforeLiveMutation": true
        },
        "exists": exists,
        "parentExists": parent_exists,
        "fileSizeBytes": metadata.as_ref().map(|metadata| metadata.len()),
        "readOnlyConnection": connection.read_only,
        "diskReadOnly": disk_read_only,
        "passwordConfigured": litedb_password_configured(connection),
        "readProbe": read_probe,
        "writeProbe": write_probe,
        "encryptionBoundary": encryption_boundary,
        "lockBoundary": lock_boundary,
        "sidecarExecutionBoundary": sidecar_execution_boundary
    })
}

pub(super) fn litedb_file_path(connection: &ResolvedConnectionProfile) -> String {
    if let Some(path) = connection.connection_string.as_deref().and_then(|value| {
        litedb_connection_string_option(value, &["filename", "file", "path", "database"])
    }) {
        return path;
    }

    connection
        .connection_string
        .as_deref()
        .and_then(|value| {
            value
                .strip_prefix("litedb://")
                .or_else(|| value.strip_prefix("file://"))
                .or(Some(value))
        })
        .map(|value| value.split('?').next().unwrap_or(value))
        .map(|value| value.split(';').next().unwrap_or(value))
        .or(connection.database.as_deref())
        .or_else(|| {
            let host = connection.host.trim();
            (!host.is_empty() && host != "127.0.0.1" && host != "localhost").then_some(host)
        })
        .unwrap_or("datapadplusplus.db")
        .to_string()
}

pub(crate) fn litedb_sidecar_path(connection: &ResolvedConnectionProfile) -> Option<String> {
    connection
        .connection_string
        .as_deref()
        .and_then(|value| {
            litedb_connection_string_option(
                value,
                &[
                    "sidecarpath",
                    "sidecar",
                    "datapadsidecarpath",
                    "datapadsidecar",
                ],
            )
        })
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn litedb_connection_option(
    connection: &ResolvedConnectionProfile,
    keys: &[&str],
) -> Option<String> {
    connection
        .connection_string
        .as_deref()
        .and_then(|value| litedb_connection_string_option(value, keys))
}

fn litedb_connection_string_option(value: &str, keys: &[&str]) -> Option<String> {
    let normalized_keys = keys
        .iter()
        .map(|key| normalize_litedb_option_key(key))
        .collect::<Vec<_>>();

    for segment in value.split(';') {
        if let Some((key, value)) = segment.split_once('=') {
            if normalized_keys
                .iter()
                .any(|candidate| candidate == &normalize_litedb_option_key(key))
            {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }

    if let Some((_, query)) = value.split_once('?') {
        for segment in query.split('&') {
            if let Some((key, value)) = segment.split_once('=') {
                if normalized_keys
                    .iter()
                    .any(|candidate| candidate == &normalize_litedb_option_key(key))
                {
                    let value = value.trim().trim_matches('"').trim_matches('\'');
                    if !value.is_empty() {
                        return Some(value.replace('+', " "));
                    }
                }
            }
        }
    }

    None
}

fn normalize_litedb_option_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn litedb_file_kind(database_path: &str) -> &'static str {
    let normalized = database_path.trim().to_ascii_lowercase();
    if normalized == ":memory:" || normalized == "memory" {
        "memory"
    } else {
        "local-file"
    }
}

fn litedb_parent_exists(path: &Path) -> bool {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.exists())
        .unwrap_or(true)
}

fn litedb_read_probe(path: &Path, file_kind: &str, exists: bool) -> Value {
    if file_kind != "local-file" {
        return json!({
            "status": "skipped",
            "reason": "memory-profile",
            "mutatesFile": false
        });
    }
    if !exists {
        return json!({
            "status": "missing",
            "reason": "database-file-not-found",
            "mutatesFile": false
        });
    }

    match File::open(path) {
        Ok(_) => json!({
            "status": "ok",
            "capability": "filesystem-read-open",
            "mutatesFile": false
        }),
        Err(error) => json!({
            "status": "blocked",
            "capability": "filesystem-read-open",
            "reason": error.to_string(),
            "mutatesFile": false
        }),
    }
}

fn litedb_write_probe(
    path: &Path,
    file_kind: &str,
    exists: bool,
    read_only_connection: bool,
    disk_read_only: bool,
) -> Value {
    if file_kind != "local-file" {
        return json!({
            "status": "skipped",
            "reason": "memory-profile",
            "mutatesFile": false
        });
    }
    if read_only_connection {
        return json!({
            "status": "blocked",
            "reason": "connection-read-only",
            "mutatesFile": false
        });
    }
    if !exists {
        return json!({
            "status": "missing",
            "reason": "database-file-not-found",
            "mutatesFile": false
        });
    }
    if disk_read_only {
        return json!({
            "status": "blocked",
            "reason": "filesystem-read-only",
            "mutatesFile": false
        });
    }

    match OpenOptions::new().write(true).open(path) {
        Ok(_) => json!({
            "status": "ok",
            "capability": "filesystem-write-open",
            "mutatesFile": false,
            "note": "OpenOptions write access was probed without writing bytes."
        }),
        Err(error) => json!({
            "status": "blocked",
            "capability": "filesystem-write-open",
            "reason": error.to_string(),
            "mutatesFile": false
        }),
    }
}

fn litedb_encryption_boundary(connection: &ResolvedConnectionProfile) -> Value {
    let password_configured = litedb_password_configured(connection);
    json!({
        "passwordConfigured": password_configured,
        "secretMaterial": if password_configured { "redacted-in-profile" } else { "not-configured" },
        "status": if password_configured { "configured-not-validated" } else { "unencrypted-or-secret-missing" },
        "liveValidation": "sidecar-required",
        "requiredForEncryptedFiles": [
            "redacted password resolution",
            "sidecar LiteDB open probe",
            "read/write request validation against the encrypted file"
        ],
        "residualRisk": "Filesystem probes do not prove LiteDB password correctness or encrypted page compatibility."
    })
}

fn litedb_lock_boundary(
    read_probe: &Value,
    write_probe: &Value,
    read_only_connection: bool,
    disk_read_only: bool,
    write_intent: bool,
) -> Value {
    json!({
        "scope": "local-file-preflight",
        "readOpenProbe": read_probe.get("status").cloned().unwrap_or(Value::Null),
        "writeOpenProbe": write_probe.get("status").cloned().unwrap_or(Value::Null),
        "writeIntent": write_intent,
        "readOnlyConnection": read_only_connection,
        "diskReadOnly": disk_read_only,
        "crossProcessContentionValidated": false,
        "exclusiveWriterLockValidated": false,
        "sidecarLockProbe": "required-before-live-execution",
        "residualRisks": [
            "LiteDB engine-level shared/exclusive lock behavior is not proven by plain filesystem open probes.",
            "External-process contention and dirty-page checkpoint state require the .NET sidecar bridge."
        ]
    })
}

fn litedb_sidecar_execution_boundary(write_intent: bool) -> Value {
    json!({
        "runtime": "dotnet-litedb-sidecar",
        "status": "plan-only-until-sidecar",
        "writeIntent": write_intent,
        "requestShapeValidated": true,
        "liveExecutionValidated": false,
        "blockedReasons": [
            "sidecar-dispatch-not-implemented",
            if write_intent { "exclusive-writer-lock-not-validated" } else { "litedb-engine-open-probe-not-validated" },
            "encrypted-file-open-not-validated"
        ],
        "promotionRequirements": [
            "bundled or configured LiteDB sidecar executable",
            "sidecar read/open probe with bounded response",
            "exclusive writer-lock evidence for mutations and maintenance",
            "encrypted-file open failure/success evidence without leaking secrets",
            "before/after validation for document edits and file workflows"
        ]
    })
}

fn litedb_password_configured(connection: &ResolvedConnectionProfile) -> bool {
    connection
        .password
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || litedb_connection_option(connection, &["password", "pwd"]).is_some()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/connection_tests.rs"]
mod tests;
