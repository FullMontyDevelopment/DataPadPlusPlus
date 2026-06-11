import { useCallback } from 'react'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { ObjectDocumentIcon } from '../../icons'
import { ObjectViewTable, SectionHeading } from '../../ObjectViewPrimitives'
import {
  fieldPresenceText,
  fieldTypeNames,
  fieldTypesText,
  fieldWarningsText,
  generateValidatorFromFields,
  mongoSchemaSampleSize,
  requiredFieldsForValidator,
} from './MongoSchemaView.helpers'

type JsonRecord = Record<string, unknown>

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoSchemaView({
  descriptor,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const fields = arrayOfRecords(payload.fields)
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const sampleSize = mongoSchemaSampleSize(payload, fields)
  const mixedTypeCount = fields.filter((field) => fieldTypeNames(field).length > 1).length
  const requiredFields = requiredFieldsForValidator(payload)
  const previewValidator = useCallback(() => {
    onPlanOperation?.({
      title: `Generate validator for ${collection}`,
      operationId: 'mongodb.validation.update',
      objectName: collection,
      parameters: {
        database,
        collection,
        validator: generateValidatorFromFields(fields, sampleSize),
      },
    })
  }, [collection, database, fields, onPlanOperation, sampleSize])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectDocumentIcon} title={descriptor.title} unit={`${fields.length} field(s)`} />
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Sampled documents</span>
          <strong>{sampleSize}</strong>
        </div>
        <div className="object-view-card">
          <span>Field paths</span>
          <strong>{fields.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Mixed types</span>
          <strong>{mixedTypeCount}</strong>
        </div>
        <div className="object-view-card">
          <span>Required fields</span>
          <strong>{requiredFields.length}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Field path', 'BSON types', 'Presence', 'Examples', 'Warnings']}
        rows={fields.map((field) => [
          stringValue(field.path),
          fieldTypesText(field),
          fieldPresenceText(field, sampleSize),
          compactJson(field.examples ?? field.example ?? ''),
          fieldWarningsText(field, sampleSize),
        ])}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      <div className="object-view-management">
        <strong>Validator</strong>
        <details className="object-view-disclosure">
          <summary>Generated rule</summary>
          <pre className="object-view-code">{prettyJson(generateValidatorFromFields(fields, sampleSize))}</pre>
        </details>
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !collection || fields.length === 0}
            onClick={previewValidator}
          >
            Prepare Validator
          </button>
        </div>
      </div>
    </div>
  )
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
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

function compactJson(value: unknown) {
  return JSON.stringify(value)
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
