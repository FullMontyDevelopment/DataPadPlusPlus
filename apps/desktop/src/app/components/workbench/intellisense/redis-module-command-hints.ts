import type { RedisCommandDoc } from '../query-builder/redis-command-docs'
import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
} from './types'

const REDIS_MODULE_KEY_KINDS = new Set([
  'json',
  'timeseries',
  'bloom',
  'cuckoo',
  'cms',
  'topk',
  'tdigest',
  'vectorset',
  'module',
])

const REDIS_SEARCH_INDEX_KINDS = new Set(['search-index', 'search-indexes'])

const REDIS_JSON_PATHS = ['$', '$.<field>', '$[*]']
const REDIS_SEARCH_QUERIES = ['*', '@field:{value}', '@field:[0 100]', '"exact phrase"']
const REDIS_SEARCH_OPTIONS = [
  'LIMIT',
  'SORTBY',
  'RETURN',
  'DIALECT',
  'PARAMS',
  'NOCONTENT',
  'WITHSCORES',
]
const REDIS_TIMESERIES_OPTIONS = [
  'LATEST',
  'COUNT',
  'FILTER_BY_TS',
  'FILTER_BY_VALUE',
  'WITHLABELS',
  'SELECTED_LABELS',
  'ALIGN',
  'AGGREGATION',
]
const REDIS_TIMESERIES_FILTER_OPTIONS = ['FILTER', 'WITHLABELS', 'SELECTED_LABELS', 'LATEST']
const REDIS_TIMESERIES_AGGREGATORS = ['avg', 'sum', 'min', 'max', 'count', 'first', 'last']
const REDIS_TIMESERIES_REDUCERS = ['avg', 'sum', 'min', 'max', 'count']
const REDIS_VECTOR_INPUTS = ['ELE', 'FP32', 'VALUES']
const REDIS_VECTOR_OPTIONS = [
  'WITHSCORES',
  'WITHATTRIBS',
  'COUNT',
  'EPSILON',
  'EF',
  'FILTER',
  'FILTER-EF',
  'TRUTH',
  'NOTHREAD',
]

const REDIS_BLOOM_KEY_COMMANDS = new Set([
  'BF.INFO',
  'BF.EXISTS',
  'BF.MEXISTS',
  'CF.INFO',
  'CF.EXISTS',
  'CF.COUNT',
  'CMS.INFO',
  'CMS.QUERY',
  'TOPK.INFO',
  'TOPK.LIST',
  'TOPK.QUERY',
  'TDIGEST.INFO',
  'TDIGEST.MIN',
  'TDIGEST.MAX',
  'TDIGEST.QUANTILE',
  'TDIGEST.CDF',
  'TDIGEST.RANK',
  'TDIGEST.REVRANK',
  'TDIGEST.TRIMMED_MEAN',
])

export function isRedisModuleKeyKind(kind: string) {
  return REDIS_MODULE_KEY_KINDS.has(normalizeKind(kind))
}

export function isRedisModuleStaticDoc(doc: RedisCommandDoc) {
  return doc.category === 'Redis Stack'
}

export function redisModuleArgumentSuggestions(
  command: string | undefined,
  position: number,
  args: string[],
  objects: CompletionObject[],
): CompletionSuggestion[] {
  if (!command) {
    return []
  }

  if (command.startsWith('JSON.')) {
    return redisJsonArgumentSuggestions(command, position, args, objects)
  }

  if (command.startsWith('TS.')) {
    return redisTimeSeriesArgumentSuggestions(command, position, args, objects)
  }

  if (command.startsWith('FT.')) {
    return redisSearchArgumentSuggestions(command, position, args, objects)
  }

  if (command.startsWith('V')) {
    return redisVectorArgumentSuggestions(command, position, args, objects)
  }

  if (REDIS_BLOOM_KEY_COMMANDS.has(command)) {
    return redisBloomArgumentSuggestions(command, position, objects)
  }

  return []
}

function redisJsonArgumentSuggestions(
  command: string,
  position: number,
  args: string[],
  objects: CompletionObject[],
) {
  if (command === 'JSON.DEBUG') {
    if (position === 1) {
      return keywordSuggestions(['MEMORY'], 'JSON.DEBUG subcommand')
    }
    if (args[0]?.toUpperCase() === 'MEMORY' && position === 2) {
      return moduleObjectSuggestions(objects, new Set(['json']), 'RedisJSON key argument')
    }
    if (args[0]?.toUpperCase() === 'MEMORY' && position === 3) {
      return jsonPathSuggestions()
    }
    return []
  }

  if (position === 1) {
    return moduleObjectSuggestions(objects, new Set(['json']), `${command} JSON key`)
  }

  if (command === 'JSON.MGET' && position === 2) {
    return [
      ...moduleObjectSuggestions(objects, new Set(['json']), `${command} JSON key`),
      ...jsonPathSuggestions(),
    ]
  }

  if (position >= 2) {
    return jsonPathSuggestions()
  }

  return []
}

function redisTimeSeriesArgumentSuggestions(
  command: string,
  position: number,
  args: string[],
  objects: CompletionObject[],
) {
  const previous = args.at(-1)?.toUpperCase()

  if (['TS.INFO', 'TS.GET', 'TS.RANGE', 'TS.REVRANGE'].includes(command) && position === 1) {
    return moduleObjectSuggestions(objects, new Set(['timeseries']), `${command} time-series key`)
  }

  if (command === 'TS.RANGE' || command === 'TS.REVRANGE') {
    if (position === 2) {
      return valueSuggestions(['-'], 'Earliest timestamp')
    }
    if (position === 3) {
      return valueSuggestions(['+'], 'Latest timestamp')
    }
    if (previous === 'COUNT') {
      return countSuggestions()
    }
    if (previous === 'AGGREGATION') {
      return valueSuggestions(REDIS_TIMESERIES_AGGREGATORS, 'TimeSeries aggregation')
    }
    return keywordSuggestions(REDIS_TIMESERIES_OPTIONS, `${command} option`)
  }

  if (command === 'TS.MRANGE' || command === 'TS.MREVRANGE') {
    if (position === 1) {
      return valueSuggestions(['-'], 'Earliest timestamp')
    }
    if (position === 2) {
      return valueSuggestions(['+'], 'Latest timestamp')
    }
    if (previous === 'FILTER') {
      return timeSeriesFilterSuggestions(objects)
    }
    if (previous === 'COUNT') {
      return countSuggestions()
    }
    if (previous === 'AGGREGATION' || previous === 'REDUCE') {
      return valueSuggestions(REDIS_TIMESERIES_REDUCERS, 'TimeSeries reducer')
    }
    return keywordSuggestions(REDIS_TIMESERIES_FILTER_OPTIONS, `${command} option`)
  }

  if (command === 'TS.MGET' || command === 'TS.QUERYINDEX') {
    if (previous === 'FILTER' || command === 'TS.QUERYINDEX') {
      return timeSeriesFilterSuggestions(objects)
    }
    return keywordSuggestions(REDIS_TIMESERIES_FILTER_OPTIONS, `${command} option`)
  }

  return []
}

function redisBloomArgumentSuggestions(
  command: string,
  position: number,
  objects: CompletionObject[],
) {
  if (position === 1) {
    return moduleObjectSuggestions(objects, new Set(['bloom', 'cuckoo', 'cms', 'topk', 'tdigest']), `${command} probabilistic key`)
  }

  if (command === 'TOPK.LIST' && position >= 2) {
    return keywordSuggestions(['WITHCOUNT'], 'Include TopK counts')
  }

  if (command.startsWith('TDIGEST.') && position >= 2) {
    return valueSuggestions(['0.5', '0.95', '0.99'], 'Quantile or value argument')
  }

  if (command !== 'BF.INFO' && command !== 'CF.INFO' && command !== 'CMS.INFO' && command !== 'TOPK.INFO') {
    return valueSuggestions(['<item>'], 'Probabilistic structure item')
  }

  return []
}

function redisSearchArgumentSuggestions(
  command: string,
  position: number,
  args: string[],
  objects: CompletionObject[],
) {
  const previous = args.at(-1)?.toUpperCase()

  if (command === 'FT._LIST') {
    return []
  }

  if (position === 1) {
    return moduleObjectSuggestions(objects, REDIS_SEARCH_INDEX_KINDS, `${command} RediSearch index`, false)
  }

  if (command === 'FT.PROFILE') {
    if (position === 2) {
      return keywordSuggestions(['SEARCH', 'AGGREGATE'], 'FT.PROFILE mode')
    }
    if (position === 3) {
      return keywordSuggestions(['QUERY'], 'FT.PROFILE query marker')
    }
    if (position === 4 || previous === 'QUERY') {
      return valueSuggestions(REDIS_SEARCH_QUERIES, 'RediSearch query')
    }
    return keywordSuggestions(['LIMITED'], 'FT.PROFILE option')
  }

  if (command === 'FT.TAGVALS' && position === 2) {
    return valueSuggestions(['<tag-field>'], 'Tag field name')
  }

  if (position === 2) {
    return valueSuggestions(REDIS_SEARCH_QUERIES, 'RediSearch query')
  }

  return keywordSuggestions(REDIS_SEARCH_OPTIONS, `${command} option`)
}

function redisVectorArgumentSuggestions(
  command: string,
  position: number,
  args: string[],
  objects: CompletionObject[],
) {
  if (!['VCARD', 'VDIM', 'VINFO', 'VSIM'].includes(command)) {
    return []
  }

  if (position === 1) {
    return moduleObjectSuggestions(objects, new Set(['vectorset']), `${command} vector-set key`)
  }

  if (command !== 'VSIM') {
    return []
  }

  const inputMode = args[1]?.toUpperCase()

  if (position === 2) {
    return keywordSuggestions(REDIS_VECTOR_INPUTS, 'VSIM input mode')
  }
  if (inputMode === 'VALUES' && position === 3) {
    return valueSuggestions(['<dimension-count>'], 'Vector dimension count')
  }
  if (inputMode === 'ELE' && position === 3) {
    return valueSuggestions(['<element>'], 'Vector set element')
  }
  if ((inputMode === 'FP32' && position === 3) || (inputMode === 'VALUES' && position === 4)) {
    return valueSuggestions(['<vector>'], 'Vector payload')
  }

  return keywordSuggestions(REDIS_VECTOR_OPTIONS, 'VSIM option')
}

function moduleObjectSuggestions(
  objects: CompletionObject[],
  kinds: Set<string>,
  detail: string,
  includePrefixes = true,
) {
  const matches = objects.filter((object) => kinds.has(normalizeKind(object.kind)))
  const suggestions = matches.map((object) =>
    suggestion(object.name, object.name, 'value', object.detail || detail, undefined, '00'),
  )

  return includePrefixes
    ? [...suggestions, ...objectPrefixes(matches, detail)]
    : suggestions
}

function objectPrefixes(objects: CompletionObject[], detail: string) {
  const prefixes = new Set<string>()

  for (const object of objects) {
    const index = object.name.indexOf(':')

    if (index > 0) {
      prefixes.add(`${object.name.slice(0, index)}:*`)
    }
  }

  return Array.from(prefixes)
    .sort()
    .map((prefix) => suggestion(prefix, prefix, 'value', detail, undefined, '00'))
}

function timeSeriesFilterSuggestions(objects: CompletionObject[]) {
  const labels = new Set(['label=value', 'type=<value>'])

  for (const object of objects.filter((item) => normalizeKind(item.kind) === 'timeseries')) {
    const prefix = object.name.split(':')[0]?.trim()

    if (prefix) {
      labels.add(`${prefix}=<value>`)
    }
  }

  return valueSuggestions(Array.from(labels).sort(), 'TimeSeries label filter')
}

function jsonPathSuggestions() {
  return valueSuggestions(REDIS_JSON_PATHS, 'RedisJSON path')
}

function countSuggestions() {
  return valueSuggestions(['100', '1000'], 'Bounded result count')
}

function keywordSuggestions(values: string[], detail: string) {
  return values.map((value) => suggestion(value, value, 'keyword', detail, undefined, '00'))
}

function valueSuggestions(values: string[], detail: string) {
  return values.map((value) => suggestion(value, value, 'value', detail, undefined, '00'))
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
  detail?: string,
  documentation?: string,
  sortText?: string,
): CompletionSuggestion {
  return {
    label,
    insertText,
    kind,
    detail,
    documentation,
    sortText,
  }
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/_/g, '-')
}
