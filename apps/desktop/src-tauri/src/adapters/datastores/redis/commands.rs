pub(super) fn is_supported_redis_read_command(parts: &[&str]) -> bool {
    let command = parts
        .first()
        .map(|part| part.to_uppercase())
        .unwrap_or_default();
    let subcommand = parts.get(1).map(|part| part.to_uppercase());

    matches!(
        command.as_str(),
        "PING" | "SCAN" | "INFO" | "DBSIZE" | "COMMAND"
    ) || matches!(
        (command.as_str(), subcommand.as_deref()),
        ("MODULE", Some("LIST"))
            | ("SLOWLOG", Some("GET" | "LEN"))
            | ("CLIENT", Some("LIST" | "INFO" | "ID"))
            | (
                "ACL",
                Some("LIST" | "WHOAMI" | "CAT" | "GETUSER" | "USERS" | "DRYRUN")
            )
            | ("LATENCY", Some("LATEST" | "DOCTOR" | "HISTORY" | "GRAPH"))
            | (
                "CLUSTER",
                Some(
                    "INFO"
                        | "NODES"
                        | "SLOTS"
                        | "KEYSLOT"
                        | "COUNTKEYSINSLOT"
                        | "GETKEYSINSLOT"
                        | "SHARDS"
                        | "LINKS"
                        | "MYID"
                        | "MYSHARDID"
                )
            )
            | (
                "SENTINEL",
                Some(
                    "MASTERS"
                        | "MASTER"
                        | "REPLICAS"
                        | "SLAVES"
                        | "SENTINELS"
                        | "GET-MASTER-ADDR-BY-NAME"
                        | "CKQUORUM"
                )
            )
            | (
                "PUBSUB",
                Some("CHANNELS" | "NUMSUB" | "NUMPAT" | "SHARDCHANNELS" | "SHARDNUMSUB")
            )
            | ("XINFO", Some("STREAM" | "GROUPS" | "CONSUMERS"))
    ) || matches!(
        command.as_str(),
        "HGETALL"
            | "GET"
            | "TYPE"
            | "TTL"
            | "PTTL"
            | "STRLEN"
            | "HLEN"
            | "LLEN"
            | "LRANGE"
            | "SCARD"
            | "SSCAN"
            | "SMEMBERS"
            | "SRANDMEMBER"
            | "ZRANGE"
            | "ZREVRANGE"
            | "ZRANK"
            | "ZREVRANK"
            | "ZSCORE"
            | "ZCARD"
            | "XLEN"
            | "XRANGE"
            | "XREVRANGE"
            | "MEMORY"
            | "OBJECT"
            | "JSON.GET"
            | "JSON.TYPE"
            | "JSON.OBJKEYS"
            | "JSON.ARRLEN"
            | "TS.RANGE"
            | "TS.REVRANGE"
            | "TS.INFO"
            | "BF.INFO"
            | "CF.INFO"
            | "CMS.INFO"
            | "TOPK.INFO"
            | "TDIGEST.INFO"
            | "FT.INFO"
            | "FT.SEARCH"
            | "FT.AGGREGATE"
    ) && parts.len() > 1
}

pub(super) fn is_redis_write_command(parts: &[&str]) -> bool {
    let command = parts
        .first()
        .map(|part| part.to_uppercase())
        .unwrap_or_default();
    let subcommand = parts.get(1).map(|part| part.to_uppercase());

    if matches!(
        (command.as_str(), subcommand.as_deref()),
        ("ACL", Some("SETUSER" | "DELUSER" | "LOAD" | "SAVE" | "LOG"))
            | (
                "CLIENT",
                Some("KILL" | "PAUSE" | "REPLY" | "SETINFO" | "SETNAME")
            )
            | ("CONFIG", _)
            | ("SCRIPT", Some("FLUSH" | "KILL" | "LOAD"))
            | (
                "FUNCTION",
                Some("LOAD" | "DELETE" | "FLUSH" | "KILL" | "RESTORE")
            )
            | ("LATENCY", Some("RESET"))
            | (
                "CLUSTER",
                Some(
                    "ADDSLOTS"
                        | "BUMPEPOCH"
                        | "DELSLOTS"
                        | "FAILOVER"
                        | "FORGET"
                        | "MEET"
                        | "REPLICATE"
                        | "RESET"
                        | "SAVECONFIG"
                        | "SETSLOT"
                )
            )
            | (
                "SENTINEL",
                Some("SET" | "MONITOR" | "REMOVE" | "RESET" | "FAILOVER" | "SIMULATE-FAILURE")
            )
    ) {
        return true;
    }

    matches!(
        command.as_str(),
        "APPEND"
            | "BLMOVE"
            | "BLMPOP"
            | "BRPOP"
            | "BRPOPLPUSH"
            | "BZPOPMAX"
            | "BZPOPMIN"
            | "DECR"
            | "DECRBY"
            | "DEL"
            | "EXPIRE"
            | "EXPIREAT"
            | "COPY"
            | "EVAL"
            | "EVALSHA"
            | "FLUSHALL"
            | "FLUSHDB"
            | "HDEL"
            | "HINCRBY"
            | "HINCRBYFLOAT"
            | "HMSET"
            | "HSET"
            | "HSETNX"
            | "INCR"
            | "INCRBY"
            | "INCRBYFLOAT"
            | "LINSERT"
            | "LPOP"
            | "LPUSH"
            | "LPUSHX"
            | "LREM"
            | "LSET"
            | "LTRIM"
            | "MSET"
            | "MSETNX"
            | "PERSIST"
            | "PEXPIRE"
            | "PEXPIREAT"
            | "PSETEX"
            | "RENAME"
            | "RENAMENX"
            | "RESTORE"
            | "SELECT"
            | "RPOP"
            | "RPOPLPUSH"
            | "RPUSH"
            | "RPUSHX"
            | "SADD"
            | "SET"
            | "SETEX"
            | "SETNX"
            | "SPOP"
            | "SREM"
            | "UNLINK"
            | "ZADD"
            | "ZINCRBY"
            | "ZPOPMAX"
            | "ZPOPMIN"
            | "ZREM"
    )
}

#[cfg(test)]
mod tests {
    use super::{is_redis_write_command, is_supported_redis_read_command};

    #[test]
    fn redis_command_support_is_validated_before_network_use() {
        assert!(is_supported_redis_read_command(&["PING"]));
        assert!(is_supported_redis_read_command(&["GET", "session:1"]));
        assert!(is_supported_redis_read_command(&["INFO"]));
        assert!(is_supported_redis_read_command(&["SLOWLOG", "GET", "10"]));
        assert!(is_supported_redis_read_command(&["ACL", "LIST"]));
        assert!(!is_supported_redis_read_command(&["GET"]));
        assert!(!is_supported_redis_read_command(&["EVAL", "return 1"]));
        assert!(is_redis_write_command(&["SET"]));
        assert!(is_redis_write_command(&["DEL"]));
        assert!(is_redis_write_command(&["FLUSHDB"]));
        assert!(is_redis_write_command(&["ACL", "SETUSER", "app"]));
        assert!(!is_redis_write_command(&["ACL", "LIST"]));
    }
}
