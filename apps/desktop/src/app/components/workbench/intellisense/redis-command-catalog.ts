import type { ResultPayload } from '@datapadplusplus/shared-types'
import type { CompletionCommand } from './types'

export function redisCommandsFromResultPayload(payload: ResultPayload): CompletionCommand[] {
  if (payload.renderer === 'batch') {
    return payload.sections.flatMap((section) =>
      section.payloads.flatMap((sectionPayload) =>
        redisCommandsFromResultPayload(sectionPayload),
      ),
    )
  }

  if (payload.renderer !== 'json') {
    return []
  }

  return redisCommandsFromValue(payload.value)
}

export function addRedisCommandsToCatalog(
  target: Map<string, CompletionCommand>,
  payload: ResultPayload,
) {
  let added = 0
  for (const command of redisCommandsFromResultPayload(payload)) {
    const name = command.name.trim().toUpperCase()
    if (!name || target.has(name)) {
      continue
    }
    target.set(name, { ...command, name })
    added += 1
  }
  return added
}

function redisCommandsFromValue(value: unknown): CompletionCommand[] {
  const record = asRecord(value)
  const metadata = [
    ...arrayValue(record.commandMetadata),
    ...arrayValue(record.commandInfo),
    ...arrayValue(record.commands),
  ]
  const normalized = metadata
    .map(redisCommandFromEntry)
    .filter((command): command is CompletionCommand => Boolean(command))

  if (normalized.length) {
    return normalized
  }

  if (typeof record.command === 'string' && /^COMMAND(?:\s|$)/i.test(record.command)) {
    return redisCommandInfoFromRawValue(record.value)
  }

  return []
}

function redisCommandInfoFromRawValue(value: unknown): CompletionCommand[] {
  if (Array.isArray(value)) {
    return value
      .map(redisCommandFromEntry)
      .filter((command): command is CompletionCommand => Boolean(command))
  }

  const record = asRecord(value)
  return Object.entries(record)
    .map(([name, item]) => redisCommandFromRecord({
      name,
      ...asRecord(item),
    }))
    .filter((command): command is CompletionCommand => Boolean(command))
}

function redisCommandFromEntry(value: unknown): CompletionCommand | undefined {
  if (Array.isArray(value)) {
    return redisCommandFromArray(value)
  }

  return redisCommandFromRecord(asRecord(value))
}

function redisCommandFromArray(value: unknown[]): CompletionCommand | undefined {
  const name = stringValue(value[0]).toUpperCase()
  if (!name) {
    return undefined
  }

  const arity = numberValue(value[1])
  const flags = stringArray(value[2])
  const aclCategories = stringArray(value[6])

  return {
    name,
    syntax: redisCommandSyntax(name, arity),
    detail: commandDetail(arity, flags, aclCategories),
    category: 'Live COMMAND INFO',
    arity,
    flags,
    aclCategories,
    firstKeyPosition: numberValue(value[3]),
    lastKeyPosition: numberValue(value[4]),
    keyStep: numberValue(value[5]),
    readOnly: readOnlyFromMetadata(flags, aclCategories),
  }
}

function redisCommandFromRecord(value: Record<string, unknown>): CompletionCommand | undefined {
  const name = stringValue(value.name ?? value.command).toUpperCase()
  if (!name) {
    return undefined
  }

  const arity = numberValue(value.arity)
  const flags = stringArray(value.flags)
  const aclCategories = stringArray(value.aclCategories ?? value.acl_categories)

  return {
    name,
    syntax: stringValue(value.syntax) || redisCommandSyntax(name, arity),
    detail: stringValue(value.detail) || commandDetail(arity, flags, aclCategories),
    category: stringValue(value.category) || stringValue(value.source) || 'Live COMMAND INFO',
    arity,
    flags,
    aclCategories,
    firstKeyPosition: numberValue(value.firstKeyPosition ?? value.first_key ?? value.firstKey),
    lastKeyPosition: numberValue(value.lastKeyPosition ?? value.last_key ?? value.lastKey),
    keyStep: numberValue(value.keyStep ?? value.step ?? value.key_step),
    readOnly: typeof value.readOnly === 'boolean'
      ? value.readOnly
      : readOnlyFromMetadata(flags, aclCategories),
  }
}

function redisCommandSyntax(name: string, arity: number | undefined) {
  if (arity === undefined || arity === 1) {
    return name
  }

  if (arity > 1) {
    return `${name} ${Array.from({ length: arity - 1 }, (_, index) => `<arg${index + 1}>`).join(' ')}`
  }

  return `${name} <arg> [arg ...]`
}

function commandDetail(
  arity: number | undefined,
  flags: string[],
  aclCategories: string[],
) {
  return [
    arity !== undefined ? `arity ${arity}` : undefined,
    flags.length ? flags.join(', ') : undefined,
    aclCategories.length ? aclCategories.join(', ') : undefined,
  ].filter(Boolean).join(' / ')
}

function readOnlyFromMetadata(flags: string[], aclCategories: string[]) {
  const loweredFlags = flags.map((item) => item.toLowerCase())
  const loweredCategories = aclCategories.map((item) => item.toLowerCase())
  return loweredFlags.includes('readonly') ||
    loweredCategories.includes('@read') ||
    loweredCategories.includes('@fast')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : []
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
