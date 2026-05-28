import {
  ObjectJobIcon,
  ObjectMemoryIcon,
  ObjectMetricIcon,
  ObjectServerIcon,
} from './icons'

type JsonRecord = Record<string, unknown>

interface MemcachedObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function MemcachedObjectViewInsights({
  kind,
  payload,
}: MemcachedObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const stats = records(payload.stats)
  const slabs = records(payload.slabs)
  const items = records(payload.items)
  const connections = records(payload.connections)
  const diagnostics = records(payload.diagnostics)

  return (
    <>
      <MemcachedCachePosture stats={stats} diagnostics={diagnostics} payload={payload} />
      <MemcachedSlabPosture slabs={slabs} />
      <MemcachedItemPosture items={items} />
      <MemcachedConnectionPosture connections={connections} diagnostics={diagnostics} />
    </>
  )
}

function MemcachedCachePosture({
  stats,
  diagnostics,
  payload,
}: {
  stats: JsonRecord[]
  diagnostics: JsonRecord[]
  payload: JsonRecord
}) {
  if (!stats.length && !diagnostics.length) {
    return null
  }

  const statValue = (metric: string) =>
    stats.find((row) => displayValue(row.metric).toLowerCase() === metric)?.value
  const diagnosticValue = (signal: string) =>
    diagnostics.find((row) => displayValue(row.signal).toLowerCase() === signal)?.value
  const memoryUsed = statValue('bytes') ?? payload.bytesUsed
  const memoryLimit = statValue('limit_maxbytes')
  const evictions = statValue('evictions') ?? payload.evictions

  return (
    <section className="object-view-section" aria-label="Memcached cache posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>Cache Posture</strong>
        <span>{stats.length + diagnostics.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Hit Rate" value={displayValue(diagnosticValue('hit rate') ?? payload.hitRate)} />
        <InsightCard label="Items" value={displayValue(statValue('curr_items') ?? payload.currentItems)} />
        <InsightCard label="Memory" value={memoryLimit ? `${displayValue(memoryUsed)} / ${displayValue(memoryLimit)}` : displayValue(memoryUsed)} />
        <InsightCard label="Evictions" value={displayValue(evictions)} />
      </div>
    </section>
  )
}

function MemcachedSlabPosture({ slabs }: { slabs: JsonRecord[] }) {
  if (!slabs.length) {
    return null
  }

  const usedChunks = slabs.reduce((sum, slab) => sum + numeric(slab.usedChunks), 0)
  const freeChunks = slabs.reduce((sum, slab) => sum + numeric(slab.freeChunks), 0)
  const busiest = slabs.reduce<JsonRecord | undefined>((current, slab) =>
    numeric(slab.usedChunks) > numeric(current?.usedChunks) ? slab : current, undefined)

  return (
    <section className="object-view-section" aria-label="Memcached slab posture">
      <div className="object-view-section-heading">
        <ObjectMemoryIcon className="panel-inline-icon" />
        <strong>Slab Posture</strong>
        <span>{slabs.length} class(es)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Used" value={usedChunks.toLocaleString()} />
        <InsightCard label="Free" value={freeChunks.toLocaleString()} />
        <InsightCard label="Busiest" value={busiest ? `Class ${displayValue(busiest.classId)}` : '-'} />
        <InsightCard label="Chunk" value={displayValue(busiest?.chunkSize)} />
      </div>
    </section>
  )
}

function MemcachedItemPosture({ items }: { items: JsonRecord[] }) {
  if (!items.length) {
    return null
  }

  const totalItems = items.reduce((sum, item) => sum + numeric(item.number), 0)
  const evicted = items.reduce((sum, item) => sum + numeric(item.evicted), 0)
  const reclaimed = items.reduce((sum, item) => sum + numeric(item.reclaimed), 0)
  const oom = items.reduce((sum, item) => sum + numeric(item.outOfMemory), 0)

  return (
    <section className="object-view-section" aria-label="Memcached item posture">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Item Posture</strong>
        <span>{items.length} class(es)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Items" value={totalItems.toLocaleString()} />
        <InsightCard label="Evicted" value={evicted.toLocaleString()} />
        <InsightCard label="Reclaimed" value={reclaimed.toLocaleString()} />
        <InsightCard label="OOM" value={oom.toLocaleString()} />
      </div>
    </section>
  )
}

function MemcachedConnectionPosture({
  connections,
  diagnostics,
}: {
  connections: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  if (!connections.length && !diagnostics.length) {
    return null
  }

  const connectionValue = (name: string) =>
    connections.find((row) => displayValue(row.name).toLowerCase() === name)?.value
  const pressure = diagnostics.find((row) => /connection pressure/i.test(displayValue(row.signal)))

  return (
    <section className="object-view-section" aria-label="Memcached connection posture">
      <div className="object-view-section-heading">
        <ObjectServerIcon className="panel-inline-icon" />
        <strong>Connection Posture</strong>
        <span>{connections.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Current" value={displayValue(connectionValue('current'))} />
        <InsightCard label="Max" value={displayValue(connectionValue('max'))} />
        <InsightCard label="Rejected" value={displayValue(connectionValue('rejected'))} />
        <InsightCard label="Pressure" value={displayValue(pressure?.value)} />
      </div>
    </section>
  )
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function isInsightKind(kind: string) {
  return [
    'server',
    'stats',
    'slabs',
    'slab',
    'items',
    'item-class',
    'settings',
    'connections',
    'diagnostics',
  ].includes(kind)
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}
