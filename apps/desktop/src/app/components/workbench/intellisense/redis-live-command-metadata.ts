import type { RedisCommandDoc } from '../query-builder/redis-command-docs'
import type { CompletionCommand } from './types'

export function liveRedisCommandDocs(commands: CompletionCommand[]): RedisCommandDoc[] {
  return commands
    .filter((metadata) => metadata.readOnly !== false)
    .map((metadata) => ({
      ...metadata,
      name: metadata.name.trim().toUpperCase(),
    }))
    .filter((metadata) => metadata.name)
    .map((metadata) => ({
      command: metadata.name,
      syntax: metadata.syntax ?? metadata.name,
      summary: metadata.detail ?? 'Redis command from live command metadata',
      category: metadata.category ?? 'Live COMMAND metadata',
      readOnly: metadata.readOnly ?? true,
    }))
}

export function isLiveRedisKeyArgument(
  command: string,
  position: number,
  commands: CompletionCommand[],
) {
  const metadata = commands.find((item) => item.name.toUpperCase() === command)
  const first = metadata?.firstKeyPosition

  if (metadata?.readOnly === false || !first || first < 1 || position < first) {
    return false
  }

  const last = metadata.lastKeyPosition && metadata.lastKeyPosition > 0
    ? metadata.lastKeyPosition
    : first
  const step = metadata.keyStep && metadata.keyStep > 0 ? metadata.keyStep : 1

  return position <= last && (position - first) % step === 0
}
