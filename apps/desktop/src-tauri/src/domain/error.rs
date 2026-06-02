use serde::Serialize;

const SECRET_REPLACEMENT: &str = "********";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        let message = message.into();

        Self {
            code: code.into(),
            message: redact_sensitive_text(&message),
        }
    }
}

pub(crate) fn redact_sensitive_text(value: &str) -> String {
    redact_auth_headers(&redact_secret_assignments(&redact_url_credentials(value)))
}

fn redact_url_credentials(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while let Some(relative_scheme_end) = value[cursor..].find("://") {
        let scheme_end = cursor + relative_scheme_end;
        let authority_start = scheme_end + 3;
        let authority_end = value[authority_start..]
            .find(['/', '?', '#', ' ', '\n', '\r', '\t'])
            .map(|index| authority_start + index)
            .unwrap_or(value.len());

        let authority = &value[authority_start..authority_end];
        let Some(userinfo_end) = authority.rfind('@') else {
            output.push_str(&value[cursor..authority_start]);
            cursor = authority_start;
            continue;
        };

        output.push_str(&value[cursor..authority_start]);
        output.push_str(SECRET_REPLACEMENT);
        output.push_str(&authority[userinfo_end..]);
        cursor = authority_end;
    }

    output.push_str(&value[cursor..]);
    output
}

fn redact_secret_assignments(value: &str) -> String {
    [
        "shared access key",
        "sharedaccesskey",
        "access_token",
        "access-token",
        "auth_token",
        "auth-token",
        "secret key",
        "secretkey",
        "api_key",
        "api-key",
        "api key",
        "password",
        "token",
        "secret",
        "pwd",
        "pass",
    ]
    .iter()
    .fold(value.to_string(), |redacted, key| {
        redact_secret_assignment_key(&redacted, key)
    })
}

fn redact_secret_assignment_key(value: &str, key: &str) -> String {
    let mut output = value.to_string();
    let mut search_from = 0;

    loop {
        let lower = output.to_lowercase();
        let Some(relative_position) = lower[search_from..].find(key) else {
            return output;
        };
        let key_start = search_from + relative_position;
        let key_end = key_start + key.len();

        if !is_assignment_key_boundary(&output, key_start, key_end) {
            search_from = key_end;
            continue;
        }

        let Some((value_start, value_end)) = assignment_value_range(&output, key_end) else {
            search_from = key_end;
            continue;
        };

        output.replace_range(value_start..value_end, SECRET_REPLACEMENT);
        search_from = value_start + SECRET_REPLACEMENT.len();
    }
}

fn is_assignment_key_boundary(value: &str, start: usize, end: usize) -> bool {
    let before_ok = value[..start]
        .chars()
        .next_back()
        .is_none_or(|character| !is_identifier_character(character));
    let after = &value[end..];
    let after_ok = match after.chars().next() {
        Some(quote @ ('"' | '\'')) => after[quote.len_utf8()..]
            .chars()
            .next()
            .is_none_or(|character| character.is_whitespace() || matches!(character, ':' | '=')),
        Some(character) => character.is_whitespace() || matches!(character, ':' | '='),
        None => true,
    };

    before_ok && after_ok
}

fn assignment_value_range(value: &str, key_end: usize) -> Option<(usize, usize)> {
    let mut cursor = key_end;
    if let Some(quote @ ('"' | '\'')) = value[cursor..].chars().next() {
        cursor += quote.len_utf8();
    }
    cursor += value[cursor..]
        .chars()
        .take_while(|character| character.is_whitespace())
        .map(char::len_utf8)
        .sum::<usize>();

    let separator = value[cursor..].chars().next()?;
    if !matches!(separator, ':' | '=') {
        return None;
    }

    cursor += separator.len_utf8();
    cursor += value[cursor..]
        .chars()
        .take_while(|character| character.is_whitespace())
        .map(char::len_utf8)
        .sum::<usize>();

    let value_start = cursor;
    let first = value[cursor..].chars().next()?;
    if matches!(first, '"' | '\'') {
        cursor += first.len_utf8();
        let inner_start = cursor;
        for character in value[cursor..].chars() {
            if character == first {
                return Some((inner_start, cursor));
            }
            cursor += character.len_utf8();
        }
        return Some((inner_start, cursor));
    }
    if matches!(first, '{' | '[') {
        return None;
    }

    for character in value[cursor..].chars() {
        if character.is_whitespace() || matches!(character, ';' | ',' | '}' | ']' | '&') {
            break;
        }
        cursor += character.len_utf8();
    }

    (cursor > value_start).then_some((value_start, cursor))
}

fn redact_auth_headers(value: &str) -> String {
    ["Bearer", "Basic"]
        .iter()
        .fold(value.to_string(), |redacted, scheme| {
            redact_auth_header_scheme(&redacted, scheme)
        })
}

fn redact_auth_header_scheme(value: &str, scheme: &str) -> String {
    let mut output = value.to_string();
    let mut search_from = 0;

    loop {
        let lower = output.to_lowercase();
        let Some(relative_position) = lower[search_from..].find(&scheme.to_lowercase()) else {
            return output;
        };
        let scheme_start = search_from + relative_position;
        let scheme_end = scheme_start + scheme.len();

        if !is_assignment_key_boundary(&output, scheme_start, scheme_end) {
            search_from = scheme_end;
            continue;
        }

        let token_start = scheme_end
            + output[scheme_end..]
                .chars()
                .take_while(|character| character.is_whitespace())
                .map(char::len_utf8)
                .sum::<usize>();
        if token_start == scheme_end {
            search_from = scheme_end;
            continue;
        }

        let mut token_end = token_start;
        for character in output[token_start..].chars() {
            if character.is_whitespace() || matches!(character, ';' | ',') {
                break;
            }
            token_end += character.len_utf8();
        }

        if token_end == token_start {
            search_from = scheme_end;
            continue;
        }

        output.replace_range(token_start..token_end, SECRET_REPLACEMENT);
        search_from = token_start + SECRET_REPLACEMENT.len();
    }
}

fn is_identifier_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
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
        let (code, hint) = if lower.contains("os error 2")
            || lower.contains("cannot find the file specified")
            || lower.contains("no such file or directory")
        {
            (
                "redis-unix-socket-missing",
                "Redis tried to open a local socket/file path that does not exist. On Windows, use TCP host and port settings instead of Unix socket mode.",
            )
        } else if lower.contains("noauth")
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

    #[test]
    fn command_errors_redact_common_secret_shapes() {
        let error = CommandError::new(
            "test",
            "password=hunter2 token: abc123 Authorization: Bearer secret mongodb://user:pass@localhost/db?access_token=query-secret&ssl=true",
        );

        assert!(!error.message.contains("hunter2"));
        assert!(!error.message.contains("abc123"));
        assert!(!error.message.contains("Bearer secret"));
        assert!(!error.message.contains("user:pass"));
        assert!(!error.message.contains("query-secret"));
        assert!(error.message.contains("password=********"));
        assert!(error.message.contains("token: ********"));
        assert!(error.message.contains("Bearer ********"));
        assert!(error
            .message
            .contains("mongodb://********@localhost/db?access_token=********&ssl=true"));
    }

    #[test]
    fn command_redaction_preserves_object_valued_secret_like_schema_fields() {
        let error = CommandError::new(
            "test",
            r#"{ "properties": { "password": { "bsonType": "string" } }, "pwd": 42 }"#,
        );

        assert!(error
            .message
            .contains(r#""password": { "bsonType": "string" }"#));
        assert!(error.message.contains(r#""pwd": ********"#));
    }
}
