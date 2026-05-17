import type { ResultPayload, StructureField } from '@datapadplusplus/shared-types'
import type {
  CompletionCatalog,
  CompletionCatalogInput,
  CompletionField,
  CompletionObject,
  CompletionSchema,
} from './types'

const OBJECT_KINDS = new Set([
  'table',
  'view',
  'collection',
  'index',
  'data-stream',
  'materialized-view',
  'prefix',
  'key',
  'hash',
  'string',
  'list',
  'set',
  'zset',
  'stream',
])

const SCHEMA_KINDS = new Set(['schema', 'database', 'keyspace'])

export function buildCompletionCatalog(input: CompletionCatalogInput): CompletionCatalog {
  const sources = new Set<string>()
  const schemas = new Map<string, CompletionSchema>()
  const objects = new Map<string, CompletionObject>()
  const fields = new Map<string, CompletionField>()

  for (const node of input.explorerNodes) {
    if (node.family !== 'shared') {
      sources.add('explorer')
    }

    if (SCHEMA_KINDS.has(node.kind)) {
      addSchema(schemas, {
        name: node.label,
        detail: node.detail,
      })
    }

    if (OBJECT_KINDS.has(node.kind)) {
      addObject(objects, {
        name: node.label,
        kind: node.kind,
        schema: schemaFromPath(node.path),
        path: node.path,
        detail: node.detail,
      })
    }

    if (node.kind === 'column' || node.kind === 'field') {
      addField(fields, {
        name: node.label,
        dataType: node.detail.split('/')[0]?.trim(),
        objectName: node.path?.at(-1),
        schema: schemaFromPath(node.path),
        detail: node.detail,
      })
    }
  }

  const structureMatchesConnection =
    input.connection &&
    input.environment &&
    input.structure?.connectionId === input.connection.id &&
    input.structure.environmentId === input.environment.id

  if (structureMatchesConnection && input.structure) {
    sources.add('structure')

    for (const group of input.structure.groups) {
      if (SCHEMA_KINDS.has(group.kind) || group.kind === 'prefix') {
        addSchema(schemas, {
          name: group.label,
          detail: group.detail,
        })
      }
    }

    for (const node of input.structure.nodes) {
      if (OBJECT_KINDS.has(node.kind) || node.fields?.length) {
        addObject(objects, {
          name: node.label,
          kind: node.kind,
          schema: node.groupId,
          detail: node.detail,
        })
      }

      for (const field of node.fields ?? []) {
        addField(fields, fieldFromStructure(field, node.label, node.groupId))
      }
    }
  }

  for (const payload of input.resultPayloads ?? []) {
    const extracted = fieldsFromPayload(payload)

    if (extracted.length > 0) {
      sources.add('results')
    }

    for (const field of extracted) {
      addField(fields, field)
    }
  }

  return {
    connectionId: input.connection?.id,
    environmentId: input.environment?.id,
    engine: input.connection?.engine,
    family: input.connection?.family,
    schemas: Array.from(schemas.values()).sort(byName),
    objects: Array.from(objects.values()).sort(byName),
    fields: Array.from(fields.values()).sort(byField),
    commands: [],
    operators: [],
    functions: [],
    snippets: [],
    loadedAt: new Date().toISOString(),
    stale: sources.size === 0,
    sources: Array.from(sources).sort(),
  }
}

function addSchema(target: Map<string, CompletionSchema>, schema: CompletionSchema) {
  const name = schema.name.trim()

  if (!name || target.has(name.toLowerCase())) {
    return
  }

  target.set(name.toLowerCase(), {
    ...schema,
    name,
  })
}

function addObject(target: Map<string, CompletionObject>, object: CompletionObject) {
  const name = object.name.trim()

  if (!name) {
    return
  }

  const key = `${object.schema ?? ''}.${name}.${object.kind}`.toLowerCase()

  if (target.has(key)) {
    return
  }

  target.set(key, {
    ...object,
    name,
  })
}

function addField(target: Map<string, CompletionField>, field: CompletionField) {
  const name = field.name.trim()

  if (!name) {
    return
  }

  const path = field.path ?? name
  const key = `${field.schema ?? ''}.${field.objectName ?? ''}.${path}`.toLowerCase()

  if (target.has(key)) {
    return
  }

  target.set(key, {
    ...field,
    name,
    path,
  })
}

function fieldFromStructure(
  field: StructureField,
  objectName?: string,
  schema?: string,
): CompletionField {
  return {
    name: field.name,
    dataType: field.dataType,
    objectName,
    schema,
    detail: [
      field.dataType,
      field.primary ? 'primary key' : undefined,
      field.nullable === false ? 'not null' : undefined,
    ]
      .filter(Boolean)
      .join(' / '),
    primary: field.primary,
  }
}

function fieldsFromPayload(payload: ResultPayload): CompletionField[] {
  if (payload.renderer === 'table') {
    return payload.columns.map((column) => ({
      name: column,
      path: column,
      detail: 'Result column',
    }))
  }

  if (payload.renderer === 'document') {
    return payload.documents.flatMap((document) => flattenValuePaths(document))
  }

  if (payload.renderer === 'searchHits') {
    return payload.hits.flatMap((hit) => flattenValuePaths(hit.source))
  }

  if (payload.renderer === 'json') {
    return flattenValuePaths(payload.value)
  }

  if (payload.renderer === 'keyvalue') {
    return [
      ...Object.keys(payload.entries).map((key) => ({
        name: key,
        path: key,
        detail: 'Key-value entry',
      })),
      ...flattenValuePaths(payload.value),
    ]
  }

  return []
}

function flattenValuePaths(value: unknown, prefix = '', depth = 0): CompletionField[] {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return []
  }

  if (Array.isArray(value)) {
    return value.slice(0, 5).flatMap((item) => flattenValuePaths(item, prefix, depth + 1))
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    const field: CompletionField = {
      name: key,
      path,
      dataType: valueTypeLabel(child),
      detail: path,
    }

    return [field, ...flattenValuePaths(child, path, depth + 1)]
  })
}

function valueTypeLabel(value: unknown) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

function schemaFromPath(path?: string[]) {
  if (!path || path.length < 2) {
    return undefined
  }

  return path.at(-2)
}

function byName<T extends { name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name)
}

function byField(left: CompletionField, right: CompletionField) {
  return (left.path ?? left.name).localeCompare(right.path ?? right.name)
}
