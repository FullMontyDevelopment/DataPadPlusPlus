export function InspectionPayloadSummary({
  drawer = false,
  payload,
}: {
  drawer?: boolean
  payload: unknown
}) {
  if (!payload || typeof payload !== 'object') {
    return (
      <p className={drawer ? 'drawer-copy' : 'panel-footnote'}>
        Object details are available for this item.
      </p>
    )
  }

  const entries = Object.entries(payload as Record<string, unknown>)
    .slice(0, 6)
    .map(([key, value]) => [readableLabel(key), inspectionValueSummary(key, value)] as const)

  return (
    <div className={drawer ? 'details-grid details-grid--drawer' : 'details-grid'}>
      {entries.map(([label, value]) => (
        <div key={label} className="detail-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function inspectionValueSummary(key: string, value: unknown) {
  if (isSensitiveKey(key)) {
    return 'Stored securely'
  }

  if (Array.isArray(value)) {
    return `${value.length} item(s)`
  }
  if (value && typeof value === 'object') {
    return `${Object.keys(value).length} field(s)`
  }
  if (value === null || value === undefined || value === '') {
    return 'None'
  }
  return redactSensitiveText(String(value))
}

function readableLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isSensitiveKey(key: string) {
  return /(password|passwd|secret|token|credential|private[_-]?key|api[_-]?key|access[_-]?key)/i
    .test(key)
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(password|pwd|token|secret|api[_-]?key)=([^;&\s]+)/gi, '$1=<redacted>')
    .replace(/:\/\/([^:/@\s]+):([^@/\s]+)@/g, '://$1:<redacted>@')
}
