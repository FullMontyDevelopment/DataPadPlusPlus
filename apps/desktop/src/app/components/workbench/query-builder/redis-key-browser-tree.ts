import type { RedisKeySummary } from '@datapadplusplus/shared-types'

export type RedisTreeRow =
  | { kind: 'prefix'; id: string; label: string; depth: number; count: number }
  | { kind: 'key'; id: string; depth: number; key: RedisKeySummary }

export function redisTreeRows(
  keys: RedisKeySummary[],
  expandedPrefixes: Set<string>,
  delimiter = ':',
): RedisTreeRow[] {
  const sorted = [...keys].sort((left, right) => left.key.localeCompare(right.key))
  const rows: RedisTreeRow[] = []
  const emittedPrefixes = new Set<string>()
  const keyDelimiter = delimiter || ':'

  for (const key of sorted) {
    const parts = key.key.split(keyDelimiter)
    let prefix = ''
    let hiddenByCollapsedPrefix = false

    for (let index = 0; index < parts.length - 1; index += 1) {
      prefix = prefix ? `${prefix}${keyDelimiter}${parts[index]}` : parts[index] ?? ''
      if (!prefix) {
        continue
      }

      if (!emittedPrefixes.has(prefix)) {
        emittedPrefixes.add(prefix)
        rows.push({
          kind: 'prefix',
          id: prefix,
          label: parts[index] ?? prefix,
          depth: index,
          count: countKeysWithPrefix(sorted, `${prefix}${keyDelimiter}`),
        })
      }

      if (!expandedPrefixes.has(prefix)) {
        hiddenByCollapsedPrefix = true
        break
      }
    }

    if (!hiddenByCollapsedPrefix) {
      rows.push({
        kind: 'key',
        id: key.key,
        depth: Math.max(parts.length - 1, 0),
        key,
      })
    }
  }

  return rows
}

export function mergeRedisKeys(
  current: RedisKeySummary[],
  incoming: RedisKeySummary[],
) {
  const byKey = new Map(current.map((key) => [key.key, key]))
  for (const key of incoming) {
    byKey.set(key.key, key)
  }
  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key))
}

export function parseRedisInitialValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function countKeysWithPrefix(keys: RedisKeySummary[], prefix: string) {
  return keys.filter((item) => item.key.startsWith(prefix)).length
}
