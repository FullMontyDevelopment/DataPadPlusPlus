export interface RedisCommandDoc {
  command: string
  syntax: string
  summary: string
  category: string
  readOnly: boolean
}

const REDIS_COMMAND_DOCS: Record<string, RedisCommandDoc> = {
  PING: doc('PING [message]', 'Checks server reachability.', 'Server'),
  SCAN: doc('SCAN cursor [MATCH pattern] [COUNT count] [TYPE type]', 'Iterates keys without blocking the server.', 'Keys'),
  DBSIZE: doc('DBSIZE', 'Returns the number of keys in the selected database.', 'Keys'),
  GET: doc('GET key', 'Reads a string value.', 'Strings'),
  STRLEN: doc('STRLEN key', 'Returns the length of a string value.', 'Strings'),
  HGETALL: doc('HGETALL key', 'Reads every field and value from a hash.', 'Hashes'),
  HLEN: doc('HLEN key', 'Returns the number of fields in a hash.', 'Hashes'),
  TYPE: doc('TYPE key', 'Returns the Redis type stored at a key.', 'Keys'),
  TTL: doc('TTL key', 'Returns a key time-to-live in seconds.', 'Keys'),
  PTTL: doc('PTTL key', 'Returns a key time-to-live in milliseconds.', 'Keys'),
  LRANGE: doc('LRANGE key start stop', 'Reads a bounded list range.', 'Lists'),
  LLEN: doc('LLEN key', 'Returns the length of a list.', 'Lists'),
  SMEMBERS: doc('SMEMBERS key', 'Reads all members of a set.', 'Sets'),
  SCARD: doc('SCARD key', 'Returns the number of members in a set.', 'Sets'),
  ZRANGE: doc('ZRANGE key start stop [WITHSCORES]', 'Reads a sorted-set range.', 'Sorted Sets'),
  ZCARD: doc('ZCARD key', 'Returns the number of members in a sorted set.', 'Sorted Sets'),
  XLEN: doc('XLEN key', 'Returns the number of entries in a stream.', 'Streams'),
  XRANGE: doc('XRANGE key start end [COUNT count]', 'Reads stream entries in ascending order.', 'Streams'),
  XINFO: doc('XINFO STREAM|GROUPS|CONSUMERS key', 'Reads stream metadata.', 'Streams'),
  INFO: doc('INFO [section]', 'Reads server diagnostics.', 'Diagnostics'),
  SLOWLOG: doc('SLOWLOG GET [count] | SLOWLOG LEN', 'Reads slow command log data.', 'Diagnostics'),
  MEMORY: doc('MEMORY USAGE key', 'Reads memory usage metadata for a key.', 'Diagnostics'),
  OBJECT: doc('OBJECT ENCODING|IDLETIME|FREQ key', 'Reads internal key metadata.', 'Diagnostics'),
  ACL: doc('ACL LIST | ACL WHOAMI | ACL USERS', 'Reads ACL and current user metadata.', 'Security'),
  CLIENT: doc('CLIENT LIST | CLIENT INFO | CLIENT ID', 'Reads connected client metadata.', 'Diagnostics'),
  MODULE: doc('MODULE LIST', 'Lists loaded Redis modules.', 'Modules'),
  PUBSUB: doc('PUBSUB CHANNELS|NUMSUB|NUMPAT', 'Reads Pub/Sub channel metadata.', 'Pub/Sub'),
  COMMAND: doc('COMMAND [INFO command]', 'Reads Redis command metadata.', 'Server'),
  CLUSTER: doc('CLUSTER INFO|NODES|SLOTS|SHARDS', 'Reads cluster topology metadata.', 'Cluster'),
  SENTINEL: doc('SENTINEL MASTERS|MASTER name|REPLICAS name', 'Reads Sentinel metadata.', 'Sentinel'),
  'JSON.GET': doc('JSON.GET key [path]', 'Reads a RedisJSON value when RedisJSON is available.', 'Redis Stack'),
  'JSON.TYPE': doc('JSON.TYPE key [path]', 'Reads a RedisJSON value type.', 'Redis Stack'),
  'JSON.OBJLEN': doc('JSON.OBJLEN key [path]', 'Reads the number of members in a RedisJSON object.', 'Redis Stack'),
  'JSON.ARRLEN': doc('JSON.ARRLEN key [path]', 'Reads the length of a RedisJSON array.', 'Redis Stack'),
  'JSON.MGET': doc('JSON.MGET key [key ...] path', 'Reads one RedisJSON path across multiple keys.', 'Redis Stack'),
  'JSON.DEBUG': doc('JSON.DEBUG MEMORY key [path]', 'Reads RedisJSON memory usage metadata.', 'Redis Stack'),
  'FT._LIST': doc('FT._LIST', 'Lists RediSearch indexes.', 'Redis Stack'),
  'FT.INFO': doc('FT.INFO index', 'Reads RediSearch index metadata.', 'Redis Stack'),
  'FT.SEARCH': doc('FT.SEARCH index query [options]', 'Runs a RediSearch query.', 'Redis Stack'),
  'FT.AGGREGATE': doc('FT.AGGREGATE index query [options]', 'Runs a RediSearch aggregation query.', 'Redis Stack'),
  'FT.EXPLAIN': doc('FT.EXPLAIN index query', 'Explains a RediSearch query plan.', 'Redis Stack'),
  'FT.PROFILE': doc('FT.PROFILE index SEARCH|AGGREGATE QUERY query [LIMITED]', 'Profiles a RediSearch query.', 'Redis Stack'),
  'FT.TAGVALS': doc('FT.TAGVALS index field', 'Reads distinct values for a RediSearch tag field.', 'Redis Stack'),
  'TS.INFO': doc('TS.INFO key', 'Reads RedisTimeSeries metadata.', 'Redis Stack'),
  'TS.GET': doc('TS.GET key [LATEST]', 'Reads the latest RedisTimeSeries sample.', 'Redis Stack'),
  'TS.RANGE': doc('TS.RANGE key fromTimestamp toTimestamp', 'Reads RedisTimeSeries samples.', 'Redis Stack'),
  'TS.REVRANGE': doc('TS.REVRANGE key fromTimestamp toTimestamp', 'Reads RedisTimeSeries samples in reverse.', 'Redis Stack'),
  'TS.MRANGE': doc('TS.MRANGE fromTimestamp toTimestamp FILTER filterExpr...', 'Reads multiple RedisTimeSeries ranges by label filters.', 'Redis Stack'),
  'TS.MREVRANGE': doc('TS.MREVRANGE fromTimestamp toTimestamp FILTER filterExpr...', 'Reads multiple RedisTimeSeries ranges in reverse by label filters.', 'Redis Stack'),
  'TS.MGET': doc('TS.MGET FILTER filterExpr...', 'Reads latest samples from matching RedisTimeSeries keys.', 'Redis Stack'),
  'TS.QUERYINDEX': doc('TS.QUERYINDEX filterExpr...', 'Lists RedisTimeSeries keys matching label filters.', 'Redis Stack'),
  'BF.INFO': doc('BF.INFO key', 'Reads Bloom filter metadata.', 'Redis Stack'),
  'BF.EXISTS': doc('BF.EXISTS key item', 'Checks whether an item may exist in a Bloom filter.', 'Redis Stack'),
  'BF.MEXISTS': doc('BF.MEXISTS key item [item ...]', 'Checks multiple Bloom filter items.', 'Redis Stack'),
  'CF.INFO': doc('CF.INFO key', 'Reads Cuckoo filter metadata.', 'Redis Stack'),
  'CF.EXISTS': doc('CF.EXISTS key item', 'Checks whether an item may exist in a Cuckoo filter.', 'Redis Stack'),
  'CF.COUNT': doc('CF.COUNT key item', 'Reads a Cuckoo filter item count.', 'Redis Stack'),
  'CMS.INFO': doc('CMS.INFO key', 'Reads Count-Min Sketch metadata.', 'Redis Stack'),
  'CMS.QUERY': doc('CMS.QUERY key item [item ...]', 'Queries Count-Min Sketch item estimates.', 'Redis Stack'),
  'TOPK.INFO': doc('TOPK.INFO key', 'Reads TopK metadata.', 'Redis Stack'),
  'TOPK.LIST': doc('TOPK.LIST key [WITHCOUNT]', 'Lists TopK items.', 'Redis Stack'),
  'TOPK.QUERY': doc('TOPK.QUERY key item [item ...]', 'Checks TopK item membership.', 'Redis Stack'),
  'TDIGEST.INFO': doc('TDIGEST.INFO key', 'Reads t-digest metadata.', 'Redis Stack'),
  'TDIGEST.MIN': doc('TDIGEST.MIN key', 'Reads the minimum t-digest value.', 'Redis Stack'),
  'TDIGEST.MAX': doc('TDIGEST.MAX key', 'Reads the maximum t-digest value.', 'Redis Stack'),
  'TDIGEST.QUANTILE': doc('TDIGEST.QUANTILE key quantile [quantile ...]', 'Reads t-digest quantile estimates.', 'Redis Stack'),
  'TDIGEST.CDF': doc('TDIGEST.CDF key value [value ...]', 'Reads t-digest cumulative distribution estimates.', 'Redis Stack'),
  'TDIGEST.RANK': doc('TDIGEST.RANK key value [value ...]', 'Reads t-digest ranks.', 'Redis Stack'),
  'TDIGEST.REVRANK': doc('TDIGEST.REVRANK key value [value ...]', 'Reads reverse t-digest ranks.', 'Redis Stack'),
  'TDIGEST.TRIMMED_MEAN': doc('TDIGEST.TRIMMED_MEAN key lowCutQuantile highCutQuantile', 'Reads a t-digest trimmed mean.', 'Redis Stack'),
  VCARD: doc('VCARD key', 'Reads the number of elements in a vector set.', 'Redis Stack'),
  VDIM: doc('VDIM key', 'Reads the dimensionality of a vector set.', 'Redis Stack'),
  VINFO: doc('VINFO key', 'Reads vector-set metadata and graph details.', 'Redis Stack'),
  VSIM: doc('VSIM key ELE|FP32|VALUES query [options]', 'Runs a vector-set similarity query.', 'Redis Stack'),
}

export function redisCommandDocs() {
  return Object.values(REDIS_COMMAND_DOCS)
}

export function redisCommandDocForText(value: string): RedisCommandDoc | undefined {
  const command = redisCommandNameFromText(value)

  if (!command) {
    return undefined
  }

  return REDIS_COMMAND_DOCS[command] ?? fallbackDoc(command)
}

export function redisCommandDetail(command: string) {
  return REDIS_COMMAND_DOCS[command.toUpperCase()]?.summary ?? 'Read-oriented Redis command'
}

function redisCommandNameFromText(value: string) {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))

  if (!firstLine) {
    return undefined
  }

  return firstLine.split(/\s+/)[0]?.toUpperCase()
}

function doc(
  syntax: string,
  summary: string,
  category: string,
): RedisCommandDoc {
  return {
    command: syntax.split(/\s+/)[0]?.toUpperCase() ?? syntax,
    syntax,
    summary,
    category,
    readOnly: true,
  }
}

function fallbackDoc(command: string): RedisCommandDoc {
  return {
    command,
    syntax: `${command} ...`,
    summary: 'Read or diagnostic command. Writes are handled through guarded editors and operation plans.',
    category: 'Command',
    readOnly: true,
  }
}
