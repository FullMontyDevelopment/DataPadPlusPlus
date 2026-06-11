import { useState } from 'react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import {
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { ObjectSearchIcon, PlayIcon } from '../../icons'
import { PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

type MongoScriptTemplate = {
  id: string
  title: string
  summary: string
  script: string
  tags: string[]
}

export function MongoScriptsView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const scripts = mongoScriptTemplates(payload.scripts)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSearchIcon} title={descriptor.title} unit={`${scripts.length} template(s)`} />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(descriptor.kind)}
        </button>
      ) : null}
      {scripts.length ? (
        <div className="mongo-script-template-list" role="list" aria-label="MongoDB script templates">
          {scripts.map((script) => (
            <MongoScriptTemplateCard key={script.id} template={script} />
          ))}
        </div>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
    </div>
  )
}

function MongoScriptTemplateCard({ template }: { template: MongoScriptTemplate }) {
  const [showScript, setShowScript] = useState(false)

  return (
    <article className="mongo-script-template" role="listitem">
      <div className="mongo-script-template-main">
        <strong>{template.title}</strong>
        <span>{template.summary}</span>
        {template.tags.length ? (
          <div className="mongo-pipeline-stage-tags" aria-label={`${template.title} tags`}>
            {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </div>
      <div className="mongo-script-template-actions">
        <button
          type="button"
          className="drawer-button"
          onClick={() => setShowScript((current) => !current)}
        >
          {showScript ? 'Hide script' : 'Show script'}
        </button>
      </div>
      {showScript ? <pre className="object-view-code">{template.script}</pre> : null}
    </article>
  )
}

function mongoScriptTemplates(value: unknown): MongoScriptTemplate[] {
  const scripts = Array.isArray(value) ? value : []
  return scripts
    .map((script, index) => mongoScriptTemplate(script, index))
    .filter((script): script is MongoScriptTemplate => Boolean(script))
}

function mongoScriptTemplate(value: unknown, index: number): MongoScriptTemplate | undefined {
  const record = asRecord(value)
  const script = typeof value === 'string'
    ? value
    : stringValue(record.script ?? record.text ?? record.content ?? record.queryTemplate)
  const trimmedScript = script.trim()
  if (!trimmedScript) {
    return undefined
  }

  const title = stringValue(record.name ?? record.title).trim()
    || mongoScriptTitle(trimmedScript, index)
  const summary = stringValue(record.description ?? record.summary).trim()
    || mongoScriptSummary(trimmedScript)
  const rawTags = Array.isArray(record.tags) ? record.tags : mongoScriptTags(trimmedScript)
  const tags = rawTags.map(String).map((tag) => tag.trim()).filter(Boolean)

  return {
    id: `${index}:${title}:${trimmedScript.slice(0, 80)}`,
    title,
    summary,
    script: trimmedScript,
    tags,
  }
}

function mongoScriptTitle(script: string, index: number) {
  const firstLine = script.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!firstLine) {
    return `Template ${index + 1}`
  }

  if (/\.aggregate\s*\(/i.test(firstLine)) {
    return 'Aggregation Script'
  }

  if (/\.find\s*\(/i.test(firstLine)) {
    return 'Find Script'
  }

  if (/runCommand\s*\(/i.test(firstLine)) {
    return 'Command Script'
  }

  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine
}

function mongoScriptSummary(script: string) {
  if (/\.aggregate\s*\(/i.test(script)) {
    return 'Runs a read-only aggregation workflow from the MongoDB scripting view.'
  }

  if (/\.find\s*\(/i.test(script)) {
    return 'Reads documents with a mongosh-style find template.'
  }

  if (/runCommand\s*\(/i.test(script)) {
    return 'Runs a read-oriented database command through the scripting view.'
  }

  return 'Reusable MongoDB script template for this object.'
}

function mongoScriptTags(script: string) {
  const tags: string[] = []
  if (/\.aggregate\s*\(/i.test(script)) {
    tags.push('aggregation')
  }
  if (/\.find\s*\(/i.test(script)) {
    tags.push('find')
  }
  if (/runCommand\s*\(/i.test(script)) {
    tags.push('command')
  }
  return tags.length ? tags : ['script']
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}
