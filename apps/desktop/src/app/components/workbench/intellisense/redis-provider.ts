import {
  redisCommandDocs,
  type RedisCommandDoc,
} from '../query-builder/redis-command-docs'
import {
  isLiveRedisKeyArgument,
  liveRedisCommandDocs,
} from './redis-live-command-metadata'
import {
  isRedisModuleKeyKind,
  isRedisModuleStaticDoc,
  redisModuleArgumentSuggestions,
} from './redis-module-command-hints'
import type {
  CompletionCommand,
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'

const REDIS_KEY_KINDS = new Set([
  'prefix',
  'key',
  'known-key',
  'hash',
  'string',
  'list',
  'set',
  'zset',
  'stream',
])

const REDIS_KEY_ARGUMENT_COMMANDS = new Set([
  'GET',
  'STRLEN',
  'HGETALL',
  'HLEN',
  'TYPE',
  'TTL',
  'PTTL',
  'LRANGE',
  'LLEN',
  'SMEMBERS',
  'SCARD',
  'ZCARD',
  'XLEN',
  'XRANGE',
  'JSON.GET',
  'JSON.TYPE',
  'TS.INFO',
  'TS.RANGE',
  'BF.INFO',
])

const REDIS_SUBCOMMANDS: Record<string, string[]> = {
  ACL: ['LIST', 'WHOAMI', 'USERS'],
  CLIENT: ['LIST', 'INFO', 'ID'],
  CLUSTER: ['INFO', 'NODES', 'SLOTS', 'SHARDS'],
  COMMAND: ['INFO'],
  MEMORY: ['USAGE', 'STATS', 'DOCTOR'],
  MODULE: ['LIST'],
  OBJECT: ['ENCODING', 'IDLETIME', 'FREQ'],
  PUBSUB: ['CHANNELS', 'NUMSUB', 'NUMPAT'],
  SENTINEL: ['MASTERS', 'MASTER', 'REPLICAS'],
  SLOWLOG: ['GET', 'LEN'],
  XINFO: ['STREAM', 'GROUPS', 'CONSUMERS'],
}

const REDIS_INFO_SECTIONS = [
  'server',
  'clients',
  'memory',
  'persistence',
  'stats',
  'replication',
  'cpu',
  'commandstats',
  'keyspace',
]

const REDIS_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream']

export function buildRedisItems(context: EditorCompletionContext): CompletionSuggestion[] {
  const line = currentLineBeforeCursor(context)
  const tokens = redisTokens(line)
  const command = tokens[0]?.toUpperCase()
  const keys = context.catalog.objects.filter(isRedisKeyCompletionObject)
  const commandMode = tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(line))

  return uniqueSuggestions([
    ...redisCommandSuggestions(context, commandMode),
    ...redisArgumentSuggestions(
      command,
      argumentIndex(tokens, line),
      tokens.slice(1),
      keys,
      context.catalog.objects,
      context.catalog.commands,
    ),
    ...redisKeySuggestions(keys, 'Known Redis key'),
  ])
}

function redisCommandSuggestions(
  context: EditorCompletionContext,
  commandMode: boolean,
): CompletionSuggestion[] {
  const builtIns = redisCommandDocs().filter((doc) => {
    return context.connection?.engine !== 'valkey' || !isRedisModuleStaticDoc(doc)
  })
  const liveCommands = liveRedisCommandDocs(context.catalog.commands)
  const docs = uniqueCommandDocs([...builtIns, ...liveCommands])

  return docs.map((doc) =>
    suggestion(
      doc.command,
      commandMode ? doc.command : doc.command.toUpperCase(),
      'command',
      doc.syntax,
      doc.summary,
      commandMode ? '10' : '80',
    ),
  )
}

function redisArgumentSuggestions(
  command: string | undefined,
  position: number,
  args: string[],
  keys: CompletionObject[],
  objects: CompletionObject[],
  commands: CompletionCommand[],
): CompletionSuggestion[] {
  if (!command) {
    return []
  }

  const moduleSuggestions = redisModuleArgumentSuggestions(command, position, args, objects)

  if (moduleSuggestions.length > 0) {
    return moduleSuggestions
  }

  if (position === 1 && REDIS_SUBCOMMANDS[command]) {
    return REDIS_SUBCOMMANDS[command].map((subcommand) =>
      suggestion(subcommand, subcommand, 'keyword', `${command} subcommand`, undefined, '00'),
    )
  }

  if (isKeyArgument(command, position, args)) {
    return redisKeySuggestions(keys, `${command} key argument`, '00')
  }

  if (isLiveRedisKeyArgument(command, position, commands)) {
    return redisKeySuggestions(keys, `${command} live key argument`, '00')
  }

  if (command === 'SCAN') {
    return scanArgumentSuggestions(position, args, keys)
  }

  if (command === 'INFO' && position === 1) {
    return REDIS_INFO_SECTIONS.map((section) =>
      suggestion(section, section, 'value', 'INFO section', undefined, '00'),
    )
  }

  if (command === 'SLOWLOG' && args[0]?.toUpperCase() === 'GET' && position === 2) {
    return countSuggestions()
  }

  if (command === 'XRANGE') {
    if (position === 2) {
      return [suggestion('-', '-', 'value', 'Oldest stream ID', undefined, '00')]
    }
    if (position === 3) {
      return [suggestion('+', '+', 'value', 'Newest stream ID', undefined, '00')]
    }
    if (position >= 4) {
      return [suggestion('COUNT', 'COUNT', 'keyword', 'Limit returned stream entries', undefined, '00')]
    }
  }

  if (command === 'LRANGE' || command === 'ZRANGE') {
    if (position === 2) {
      return [suggestion('0', '0', 'value', 'Start at first item', undefined, '00')]
    }
    if (position === 3) {
      return [suggestion('-1', '-1', 'value', 'Read through the end', undefined, '00')]
    }
    if (command === 'ZRANGE' && position >= 4) {
      return [suggestion('WITHSCORES', 'WITHSCORES', 'keyword', 'Include sorted-set scores', undefined, '00')]
    }
  }

  if (command === 'SENTINEL' && ['MASTER', 'REPLICAS'].includes(args[0]?.toUpperCase() ?? '') && position === 2) {
    return [suggestion('<master-name>', '<master-name>', 'value', 'Sentinel master name', undefined, '00')]
  }

  return []
}

function scanArgumentSuggestions(
  position: number,
  args: string[],
  keys: CompletionObject[],
): CompletionSuggestion[] {
  const previous = args.at(-1)?.toUpperCase()

  if (position === 1) {
    return [suggestion('0', '0', 'value', 'Start a new SCAN cursor', undefined, '00')]
  }
  if (previous === 'MATCH') {
    return redisKeyPrefixes(keys, 'SCAN MATCH pattern', '00')
  }
  if (previous === 'COUNT') {
    return countSuggestions()
  }
  if (previous === 'TYPE') {
    return REDIS_TYPES.map((type) =>
      suggestion(type, type, 'value', 'Redis key type', undefined, '00'),
    )
  }

  return ['MATCH', 'COUNT', 'TYPE'].map((option) =>
    suggestion(option, option, 'keyword', 'SCAN option', undefined, '00'),
  )
}

function isKeyArgument(command: string, position: number, args: string[]) {
  if (REDIS_KEY_ARGUMENT_COMMANDS.has(command)) {
    return position === 1
  }

  if (command === 'MEMORY' && args[0]?.toUpperCase() === 'USAGE') {
    return position === 2
  }
  if (command === 'OBJECT' && (REDIS_SUBCOMMANDS.OBJECT ?? []).includes(args[0]?.toUpperCase() ?? '')) {
    return position === 2
  }
  if (command === 'XINFO' && (REDIS_SUBCOMMANDS.XINFO ?? []).includes(args[0]?.toUpperCase() ?? '')) {
    return position === 2
  }

  return false
}

function isRedisKeyCompletionObject(object: CompletionObject) {
  return REDIS_KEY_KINDS.has(object.kind) || isRedisModuleKeyKind(object.kind)
}

function redisKeySuggestions(
  keys: CompletionObject[],
  detail: string,
  sortText = '20',
): CompletionSuggestion[] {
  return [
    ...keys.map((key) => suggestion(key.name, key.name, 'value', key.detail ?? detail, undefined, sortText)),
    ...redisKeyPrefixes(keys, detail, sortText),
  ]
}

function redisKeyPrefixes(
  keys: CompletionObject[],
  detail: string,
  sortText = '20',
): CompletionSuggestion[] {
  const prefixes = new Set<string>()

  for (const key of keys) {
    const index = key.name.indexOf(':')

    if (index > 0) {
      prefixes.add(`${key.name.slice(0, index)}:*`)
    }
  }

  return Array.from(prefixes)
    .sort()
    .map((prefix) => suggestion(prefix, prefix, 'value', detail, undefined, sortText))
}

function countSuggestions() {
  return ['100', '1000'].map((count) =>
    suggestion(count, count, 'value', 'Bounded result count', undefined, '00'),
  )
}

function currentLineBeforeCursor(context: EditorCompletionContext) {
  return context.queryText
    .slice(0, context.cursorOffset ?? context.queryText.length)
    .split(/\r?\n/)
    .at(-1)
    ?.trimStart() ?? ''
}

function argumentIndex(tokens: string[], line: string) {
  if (tokens.length === 0) {
    return 0
  }

  return Math.max(1, tokens.length - 1 + (hasTrailingWhitespace(line) ? 1 : 0))
}

function redisTokens(value: string) {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | undefined

  for (const character of value) {
    if (quote) {
      if (character === quote) {
        quote = undefined
      } else {
        current += character
      }
      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += character
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function hasTrailingWhitespace(value: string) {
  return /\s$/.test(value)
}

function uniqueCommandDocs(docs: RedisCommandDoc[]) {
  const seen = new Set<string>()
  const result: RedisCommandDoc[] = []

  for (const doc of docs) {
    if (!seen.has(doc.command)) {
      seen.add(doc.command)
      result.push(doc)
    }
  }

  return result
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

function uniqueSuggestions(suggestions: CompletionSuggestion[]) {
  const seen = new Set<string>()
  const result: CompletionSuggestion[] = []

  for (const item of suggestions) {
    const key = `${item.kind}:${item.label}:${item.insertText}`.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}
