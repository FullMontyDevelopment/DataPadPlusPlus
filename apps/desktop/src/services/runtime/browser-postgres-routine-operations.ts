type PostgresRoutineArgument = {
  dataType: string
  name: string
  named: boolean
}

export function postgresRoutineExecuteRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const objectParts = postgresObjectParts(objectName, parameters)
  const routineName =
    stringParameter(parameters, 'routineName') ??
    stringParameter(parameters, 'functionName') ??
    stringParameter(parameters, 'procedureName') ??
    postgresRoutineName(parameters.objectName) ??
    objectParts.object
  const schema = stringParameter(parameters, 'schema') ?? objectParts.schema
  const routineKind = (
    stringParameter(parameters, 'routineKind') ??
    stringParameter(parameters, 'objectKind') ??
    'function'
  ).toLowerCase()
  const argumentsText =
    stringParameter(parameters, 'arguments') ??
    stringParameter(parameters, 'routineArguments') ??
    ''
  const returns =
    stringParameter(parameters, 'returns') ??
    stringParameter(parameters, 'returnType')
  const args = parsePostgresRoutineArguments(argumentsText)
  const target = `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(routineName)}`
  const callArgs = postgresRoutineCallArguments(args)
  const statement = routineKind.includes('procedure')
    ? `call ${target}(${callArgs});`
    : `select ${target}(${callArgs}) as result;`
  const lines = [
    '-- PostgreSQL routine execution preview.',
    '-- Bind parameter values explicitly and review volatility, permissions, defaults, and result cardinality before running.',
  ]

  if (argumentsText.trim()) {
    lines.push(`-- Signature: ${argumentsText.trim()}`)
  }
  if (returns?.trim()) {
    lines.push(`-- Returns: ${returns.trim()}`)
  }
  if (args.length === 0) {
    lines.push('-- Input parameters: none detected.')
  } else {
    lines.push('-- Bindings:')
    args.forEach((arg, index) => {
      lines.push(`-- $${index + 1} ${arg.name} ${arg.dataType} = <${arg.name}>`)
    })
  }

  lines.push(statement)
  return lines.join('\n')
}

function postgresObjectParts(
  objectName: string,
  parameters: Record<string, unknown>,
): { object: string; schema: string } {
  const explicitSchema = stringParameter(parameters, 'schema')
  const explicitObject =
    stringParameter(parameters, 'routineName') ??
    stringParameter(parameters, 'objectName')

  if (explicitObject) {
    return {
      object: postgresRoutineName(explicitObject) ?? explicitObject,
      schema: explicitSchema ?? 'public',
    }
  }

  const parts = objectName
    .split('.')
    .map(cleanPostgresIdentifier)
    .filter(Boolean)

  if (parts.length >= 2) {
    return {
      object: parts.at(-1) ?? '<routine>',
      schema: explicitSchema ?? parts[0] ?? 'public',
    }
  }

  return {
    object: parts[0] ?? '<routine>',
    schema: explicitSchema ?? 'public',
  }
}

function postgresRoutineName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  return value
    .split('.')
    .map(cleanPostgresIdentifier)
    .filter(Boolean)
    .at(-1)
}

function cleanPostgresIdentifier(value: string) {
  return value.trim().replace(/^["`[]|["`\]]$/g, '').replace(/""/g, '"')
}

function postgresRoutineCallArguments(args: PostgresRoutineArgument[]) {
  if (args.length === 0) {
    return ''
  }

  return `\n  ${args.map((arg, index) => {
    const placeholder = `$${index + 1}`
    return arg.named ? `${postgresArgumentReference(arg.name)} => ${placeholder}` : placeholder
  }).join(',\n  ')}\n`
}

function parsePostgresRoutineArguments(argumentsText: string): PostgresRoutineArgument[] {
  const args: PostgresRoutineArgument[] = []

  for (const part of splitPostgresArguments(argumentsText)) {
    const cleaned = stripPostgresArgumentDefault(part)
    if (!cleaned) {
      continue
    }

    const tokens = cleaned.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) {
      continue
    }

    const mode = tokens[0]?.replace(/^"|"$/g, '').toLowerCase()
    const hasMode = mode === 'in' || mode === 'out' || mode === 'inout' || mode === 'variadic'
    if (mode === 'out') {
      continue
    }

    const offset = hasMode ? 1 : 0
    const remainder = tokens.slice(offset)
    if (remainder.length === 0) {
      continue
    }

    const hasNamedArgument = remainder.length >= 2 && !postgresTypeStartsArgument(remainder[0] ?? '')
    const name = hasNamedArgument
      ? cleanPostgresIdentifier(remainder[0] ?? '')
      : `arg${args.length + 1}`
    const dataType = hasNamedArgument ? remainder.slice(1).join(' ') : remainder.join(' ')

    args.push({
      dataType: dataType || '<unknown>',
      name: name || `arg${args.length + 1}`,
      named: hasNamedArgument,
    })
  }

  return args
}

function splitPostgresArguments(value: string) {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const previous = index > 0 ? value[index - 1] : undefined
    if (character === "'" && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote
    } else if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (!inSingleQuote && !inDoubleQuote && character === '(') {
      depth += 1
    } else if (!inSingleQuote && !inDoubleQuote && character === ')' && depth > 0) {
      depth -= 1
    } else if (!inSingleQuote && !inDoubleQuote && depth === 0 && character === ',') {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }

  const tail = value.slice(start).trim()
  if (tail) {
    parts.push(tail)
  }

  return parts
}

function stripPostgresArgumentDefault(value: string) {
  const lower = value.toLowerCase()
  const defaultIndex = lower.indexOf(' default ')
  const assignmentIndex = lower.indexOf(' = ')
  const cutIndex = [defaultIndex, assignmentIndex]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  return (cutIndex === undefined ? value : value.slice(0, cutIndex)).trim()
}

function postgresTypeStartsArgument(token: string) {
  const normalized = cleanPostgresIdentifier(token).toLowerCase()
  return normalized.endsWith('[]') ||
    [
      'bigint',
      'bigserial',
      'bool',
      'boolean',
      'box',
      'bytea',
      'character',
      'cidr',
      'circle',
      'date',
      'decimal',
      'double',
      'inet',
      'int',
      'int2',
      'int4',
      'int8',
      'integer',
      'interval',
      'json',
      'jsonb',
      'line',
      'lseg',
      'macaddr',
      'money',
      'numeric',
      'path',
      'point',
      'polygon',
      'real',
      'serial',
      'smallint',
      'text',
      'time',
      'timestamp',
      'tsquery',
      'tsvector',
      'uuid',
      'varchar',
      'xml',
    ].includes(normalized)
}

function postgresArgumentReference(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : quotePostgresIdentifier(name)
}

function quotePostgresIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
