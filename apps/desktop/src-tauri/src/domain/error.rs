use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::new("io-error", error.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("serialization-error", error.to_string())
    }
}

impl From<base64::DecodeError> for CommandError {
    fn from(error: base64::DecodeError) -> Self {
        Self::new("decode-error", error.to_string())
    }
}

impl From<sqlx::Error> for CommandError {
    fn from(error: sqlx::Error) -> Self {
        let raw = error.to_string();
        let lower = raw.to_lowercase();
        let (code, hint) = if lower.contains("unable to open database file")
            || lower.contains("cannot open database file")
        {
            (
                "sqlite-open-file-failed",
                "SQLite could not open that database file. Check the file path, folder permissions, and whether the file exists.",
            )
        } else if lower.contains("database is locked") || lower.contains("database locked") {
            (
                "sqlite-database-locked",
                "SQLite reports that the database is locked. Close other writers or increase the busy timeout.",
            )
        } else if lower.contains("readonly database") || lower.contains("read-only database") {
            (
                "sqlite-read-only",
                "SQLite opened the file as read-only or the OS denied writes. Check file permissions and connection open mode.",
            )
        } else if lower.contains("file is not a database")
            || lower.contains("not a database")
            || lower.contains("database disk image is malformed")
        {
            (
                "sqlite-file-invalid",
                "SQLite could not read this as a valid database file. The file may be malformed, encrypted, or not a SQLite database.",
            )
        } else if lower.contains("no such table") {
            (
                "sqlite-no-such-table",
                "SQLite could not find that table in the opened file. Verify the Database file path and use Explorer to select the exact table.",
            )
        } else if lower.contains("no such column") {
            (
                "sqlite-no-such-column",
                "SQLite could not find that column. Refresh metadata and check the table schema.",
            )
        } else if lower.contains("unique constraint failed") {
            (
                "sqlite-unique-constraint",
                "SQLite rejected the change because a UNIQUE constraint would be violated.",
            )
        } else if lower.contains("foreign key constraint failed") {
            (
                "sqlite-foreign-key-constraint",
                "SQLite rejected the change because a foreign key constraint would be violated.",
            )
        } else if lower.contains("check constraint failed") {
            (
                "sqlite-check-constraint",
                "SQLite rejected the change because a CHECK constraint would be violated.",
            )
        } else if lower.contains("constraint failed") {
            (
                "sqlite-constraint-failed",
                "SQLite rejected the change because a constraint would be violated.",
            )
        } else if lower.contains("syntax error") {
            (
                "sqlite-syntax-error",
                "SQLite could not parse the SQL statement. Check SQLite syntax and identifier quoting.",
            )
        } else if lower.contains("disk i/o error") {
            (
                "sqlite-disk-io-error",
                "SQLite hit a disk I/O error. Check the file location, disk health, and available permissions.",
            )
        } else if lower.contains("database or disk is full") {
            (
                "sqlite-database-full",
                "SQLite could not write because the database or disk is full.",
            )
        } else {
            ("sql-execution-error", "The SQL adapter returned an error.")
        };

        Self::new(code, format!("{hint} Details: {raw}"))
    }
}

impl From<mongodb::error::Error> for CommandError {
    fn from(error: mongodb::error::Error) -> Self {
        Self::new("mongodb-error", error.to_string())
    }
}

impl From<mongodb::bson::ser::Error> for CommandError {
    fn from(error: mongodb::bson::ser::Error) -> Self {
        Self::new("bson-serialization-error", error.to_string())
    }
}

impl From<mongodb::bson::de::Error> for CommandError {
    fn from(error: mongodb::bson::de::Error) -> Self {
        Self::new("bson-deserialization-error", error.to_string())
    }
}

impl From<redis::RedisError> for CommandError {
    fn from(error: redis::RedisError) -> Self {
        let raw = error.to_string();
        let lower = raw.to_lowercase();
        let (code, hint) = if lower.contains("noauth")
            || lower.contains("authentication")
            || lower.contains("invalid username-password")
        {
            (
                "redis-authentication-failed",
                "Redis authentication failed. Check the username, password, ACL user, and selected database.",
            )
        } else if lower.contains("noperm") || lower.contains("permission") {
            (
                "redis-acl-denied",
                "Redis denied this command for the current ACL user. Check command categories and key patterns.",
            )
        } else if lower.contains("moved") || lower.contains("ask") {
            (
                "redis-cluster-redirect",
                "Redis returned a cluster redirection. Use cluster-aware settings or connect to the correct node.",
            )
        } else if lower.contains("clusterdown") {
            (
                "redis-cluster-down",
                "Redis Cluster is reporting CLUSTERDOWN. Check slot coverage and cluster health.",
            )
        } else if lower.contains("read only") || lower.contains("readonly") {
            (
                "redis-readonly-replica",
                "Redis rejected the command because this endpoint is read-only. Use a primary endpoint for writes.",
            )
        } else if lower.contains("unknown command") {
            (
                "redis-unknown-command",
                "Redis does not recognize this command. The server version or required module may be missing.",
            )
        } else if lower.contains("oom") || lower.contains("out of memory") {
            (
                "redis-out-of-memory",
                "Redis is out of memory or blocked by maxmemory policy. Check memory settings and eviction policy.",
            )
        } else if lower.contains("cannot connect to tcp with tls without the tls feature") {
            (
                "redis-tls-unavailable",
                "This build cannot open TLS Redis connections. Use a non-TLS endpoint or a build with Redis TLS enabled.",
            )
        } else if lower.contains("tls")
            || lower.contains("certificate")
            || lower.contains("handshake")
        {
            (
                "redis-tls-failure",
                "Redis TLS negotiation failed. Check TLS mode, certificates, host name validation, and port.",
            )
        } else if lower.contains("timed out") || lower.contains("timeout") {
            (
                "redis-timeout",
                "Redis did not respond before the timeout. Check network reachability and server load.",
            )
        } else if lower.contains("loading") || lower.contains("persistence") {
            (
                "redis-persistence-state",
                "Redis is busy loading or in a persistence-related state. Try again after persistence completes.",
            )
        } else {
            ("redis-error", "Redis returned an error.")
        };

        Self::new(code, format!("{hint} Details: {raw}"))
    }
}

impl From<tiberius::error::Error> for CommandError {
    fn from(error: tiberius::error::Error) -> Self {
        let raw = error.to_string();
        let lower = raw.to_lowercase();
        let (code, hint) = if lower.contains("login failed")
            || lower.contains("18456")
            || lower.contains("authentication")
        {
            (
                "sqlserver-login-failed",
                "SQL Server login failed. Check the authentication mode, login name, password, and target database.",
            )
        } else if lower.contains("certificate")
            || lower.contains("tls")
            || lower.contains("ssl")
            || lower.contains("handshake")
        {
            (
                "sqlserver-tls-failure",
                "SQL Server TLS negotiation failed. Check encryption, certificate trust, host name, and CA settings.",
            )
        } else if lower.contains("timeout") || lower.contains("timed out") {
            (
                "sqlserver-timeout",
                "SQL Server did not respond before the timeout. Check network reachability, server load, and command timeout settings.",
            )
        } else if lower.contains("invalid object name") || lower.contains("code: 208") {
            (
                "sqlserver-invalid-object-name",
                "SQL Server could not find that object. Check the selected database, schema, and whether the object exists.",
            )
        } else if lower.contains("permission")
            || lower.contains("denied")
            || lower.contains("code: 229")
        {
            (
                "sqlserver-permission-denied",
                "SQL Server denied this operation for the current login. Check role membership, grants, and object ownership.",
            )
        } else if lower.contains("deadlock") || lower.contains("1205") {
            (
                "sqlserver-deadlock",
                "SQL Server chose this request as a deadlock victim. Retry after reviewing the blocking workload.",
            )
        } else if lower.contains("database")
            && (lower.contains("offline") || lower.contains("recovery"))
        {
            (
                "sqlserver-database-unavailable",
                "The target SQL Server database is offline, recovering, or otherwise unavailable.",
            )
        } else if lower.contains("failover") || lower.contains("multi-subnet") {
            (
                "sqlserver-failover",
                "SQL Server failover or listener routing interrupted the request. Check availability group and multi-subnet settings.",
            )
        } else {
            ("sqlserver-error", "SQL Server returned an error.")
        };

        Self::new(code, format!("{hint} Details: {raw}"))
    }
}

#[cfg(test)]
mod tests {
    use super::CommandError;
    use std::borrow::Cow;

    #[test]
    fn sqlserver_error_mapping_adds_actionable_invalid_object_hint() {
        let error: CommandError = tiberius::error::Error::Protocol(Cow::Borrowed(
            "Token error: 'Invalid object name 'accounts'.' on server executing on line 1 (code: 208)",
        ))
        .into();

        assert_eq!(error.code, "sqlserver-invalid-object-name");
        assert!(error.message.contains("selected database"));
    }
}
