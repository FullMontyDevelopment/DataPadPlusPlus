use super::super::*;

pub(super) fn redis_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let key = string_parameter(parameters, "key").unwrap_or_else(|| object_name.into());
    let key_token = redis_cli_token(&key);
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "db"))
        .unwrap_or_else(|| "0".into());
    let redis_type = string_parameter(parameters, "redisType").unwrap_or_else(|| "string".into());

    if operation_id.ends_with("key.export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        return format!(
            "# Export Redis {redis_type} key {key_token} as {format}\nSELECT {database}\nTYPE {key_token}\nTTL {key_token}\nMEMORY USAGE {key_token}\n{}",
            redis_export_read_command(&redis_type, &key_token)
        );
    }

    if operation_id.ends_with("key.import") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        let mode =
            string_parameter(parameters, "mode").unwrap_or_else(|| "create-or-replace".into());
        let ttl = string_parameter(parameters, "ttl").unwrap_or_else(|| "preserve".into());
        let validation = string_parameter(parameters, "validation")
            .unwrap_or_else(|| "validate-before-write".into());
        return format!(
            "# Import Redis {redis_type} key {key_token} from {format}\nSELECT {database}\n# mode: {mode}; ttl: {ttl}; validation: {validation}\n{}",
            redis_import_write_command(&redis_type, &key_token)
        );
    }

    if operation_id.ends_with("key.rename") {
        let new_key = string_parameter(parameters, "newKey")
            .or_else(|| string_parameter(parameters, "destinationKey"))
            .unwrap_or_else(|| "<new-key>".into());
        return format!(
            "SELECT {database}\nRENAMENX {key_token} {}",
            redis_cli_token(&new_key)
        );
    }

    if operation_id.ends_with("key.copy") {
        let destination_key = string_parameter(parameters, "destinationKey")
            .or_else(|| string_parameter(parameters, "newKey"))
            .unwrap_or_else(|| "<copy-key>".into());
        let destination_database = string_parameter(parameters, "destinationDatabase")
            .or_else(|| string_parameter(parameters, "targetDatabase"))
            .unwrap_or_else(|| database.clone());
        let replace = string_parameter(parameters, "mode")
            .map(|value| value.eq_ignore_ascii_case("replace"))
            .unwrap_or(false);
        return format!(
            "SELECT {database}\nCOPY {key_token} {} DB {destination_database}{}",
            redis_cli_token(&destination_key),
            if replace { " REPLACE" } else { "" }
        );
    }

    if operation_id.ends_with("key.move") {
        let destination_database = string_parameter(parameters, "destinationDatabase")
            .or_else(|| string_parameter(parameters, "targetDatabase"))
            .unwrap_or_else(|| "1".into());
        return format!("SELECT {database}\nMOVE {key_token} {destination_database}");
    }

    if operation_id.ends_with("key.expire") {
        let seconds = numeric_parameter(parameters, "ttlSeconds")
            .or_else(|| numeric_parameter(parameters, "seconds"))
            .unwrap_or(3600);
        return format!("SELECT {database}\nEXPIRE {key_token} {seconds}");
    }

    if operation_id.ends_with("key.persist") {
        return format!("SELECT {database}\nPERSIST {key_token}");
    }

    if operation_id.ends_with("stream.ack") {
        let group = string_parameter(parameters, "group").unwrap_or_else(|| "<group>".into());
        let entry_ids = redis_string_list_parameter(parameters, "entryIds", "<entry-id>");
        return format!(
            "SELECT {database}\nXACK {key_token} {} {}",
            redis_cli_token(&group),
            entry_ids
                .iter()
                .map(|entry| redis_cli_token(entry))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    if operation_id.ends_with("stream.delete-entry") {
        let entry_ids = redis_string_list_parameter(parameters, "entryIds", "<entry-id>");
        return format!(
            "SELECT {database}\nXDEL {key_token} {}",
            entry_ids
                .iter()
                .map(|entry| redis_cli_token(entry))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" | "execute" => format!("SCAN 0 MATCH {key_token}* COUNT 100"),
        "metrics" => "INFO\nSLOWLOG GET 20".into(),
        _ => format!("# {operation_id}\n# key: {key_token}"),
    }
}

fn redis_export_read_command(redis_type: &str, key_token: &str) -> String {
    match redis_type {
        "hash" => format!("HGETALL {key_token}"),
        "list" => format!("LRANGE {key_token} 0 -1"),
        "set" => format!("SMEMBERS {key_token}"),
        "zset" => format!("ZRANGE {key_token} 0 -1 WITHSCORES"),
        "stream" => format!("XRANGE {key_token} - +"),
        "json" => format!("JSON.GET {key_token} $"),
        "timeseries" => format!("TS.RANGE {key_token} - +"),
        _ => format!("GET {key_token}"),
    }
}

fn redis_import_write_command(redis_type: &str, key_token: &str) -> String {
    match redis_type {
        "hash" => format!("HSET {key_token} <field> <value>"),
        "list" => format!("RPUSH {key_token} <value>"),
        "set" => format!("SADD {key_token} <member>"),
        "zset" => format!("ZADD {key_token} <score> <member>"),
        "stream" => format!("XADD {key_token} * <field> <value>"),
        "json" => format!("JSON.SET {key_token} $ <json>"),
        "timeseries" => format!("TS.ADD {key_token} <timestamp> <value>"),
        _ => format!("SET {key_token} <value>"),
    }
}

fn redis_string_list_parameter(
    parameters: Option<&BTreeMap<String, Value>>,
    key: &str,
    fallback: &str,
) -> Vec<String> {
    let Some(value) = parameters.and_then(|values| values.get(key)) else {
        return vec![fallback.into()];
    };

    match value {
        Value::Array(items) => {
            let values = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if values.is_empty() {
                vec![fallback.into()]
            } else {
                values
            }
        }
        Value::String(raw) => {
            let values = raw
                .split([',', ' '])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if values.is_empty() {
                vec![fallback.into()]
            } else {
                values
            }
        }
        _ => vec![fallback.into()],
    }
}

fn redis_cli_token(value: &str) -> String {
    if value.chars().all(|item| {
        item.is_ascii_alphanumeric() || matches!(item, ':' | '_' | '-' | '.' | '/' | '{' | '}')
    }) {
        value.into()
    } else {
        format!("\"{}\"", escape_double_quoted(value))
    }
}
