import type {
  ExecutionResultEnvelope,
  ResultPayload,
  ResultRenderer,
  SingleResultPayload,
} from '@datapadplusplus/shared-types'

interface CanonicalResultSource {
  context?: Extract<ResultPayload, { renderer: 'batch' }>
  payload: SingleResultPayload
}

export function projectDeferredResultPayload(
  result: ExecutionResultEnvelope,
  renderer: ResultRenderer,
): ResultPayload | undefined {
  const existing = result.payloads.find((payload) => payload.renderer === renderer)
  if (existing) {
    return existing
  }

  const source = canonicalResultSource(result.payloads)
  if (!source) {
    return undefined
  }
  const value = canonicalSourceValue(source.payload)

  if (renderer === 'json') {
    return {
      renderer: 'json',
      value: scriptResultValue(source, value),
    }
  }

  if (renderer === 'table' && Array.isArray(value)) {
    return {
      renderer: 'table',
      columns: ['document'],
      rows: value.map((document) => [safeStringify(document)]),
    }
  }

  if (renderer === 'raw') {
    const resultText = prettyStringify(scriptResultValue(source, value))
    const consoleText = canonicalConsole(source)
    return {
      renderer: 'raw',
      text: consoleText
        ? `Console\n-------\n${consoleText}\n\nResult\n------\n${resultText}`
        : resultText,
    }
  }

  return undefined
}

function canonicalResultSource(payloads: ResultPayload[]): CanonicalResultSource | undefined {
  for (const payload of payloads) {
    if (payload.renderer === 'document' || payload.renderer === 'json') {
      return { payload }
    }

    if (payload.renderer === 'batch') {
      for (const section of [...payload.sections].reverse()) {
        const source = canonicalSingleResultSource(section.payloads)
        if (source) {
          return { context: payload, payload: source }
        }
      }
    }
  }

  return undefined
}

function canonicalSingleResultSource(
  payloads: SingleResultPayload[],
): SingleResultPayload | undefined {
  return payloads.find((payload) =>
    payload.renderer === 'document' || payload.renderer === 'json')
}

function canonicalSourceValue(payload: SingleResultPayload): unknown {
  if (payload.renderer === 'document') {
    return payload.documents
  }

  if (payload.renderer === 'json') {
    return payload.value
  }

  return undefined
}

function scriptResultValue(source: CanonicalResultSource, value: unknown) {
  if (isCanonicalScriptValue(value)) {
    return value
  }

  const metadata = source.context?.metadata ??
    (source.payload.renderer === 'document' ? source.payload.metadata : undefined)
  const consoleText = canonicalConsole(source)

  if (!metadata && !consoleText) {
    return value
  }

  return {
    result: value,
    operations: metadata?.operations ?? [],
    console: consoleText,
  }
}

function canonicalConsole(source: CanonicalResultSource) {
  return source.context?.console ??
    (source.payload.renderer === 'document' ? source.payload.console : undefined) ??
    (source.payload.renderer === 'json' && isCanonicalScriptValue(source.payload.value)
      ? source.payload.value.console
      : undefined) ??
    ''
}

function isCanonicalScriptValue(
  value: unknown,
): value is { result: unknown; operations: unknown[]; console: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return 'result' in candidate &&
    Array.isArray(candidate.operations) &&
    typeof candidate.console === 'string'
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function prettyStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
