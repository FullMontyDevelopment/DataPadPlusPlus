import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getMongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { MongoSchemaView } from './MongoSchemaView'
import {
  fieldPresenceText,
  fieldTypesText,
  fieldWarningsText,
  generateValidatorFromFields,
} from './MongoSchemaView.helpers'

const descriptor = getMongoObjectViewDescriptor('schema-preview')
const fields = [
  { path: '_id', type: 'objectId', typeDistribution: { objectId: 20 }, count: 20, examples: ['64f1e7'] },
  { path: 'sku', type: 'string', typeDistribution: { string: 20 }, count: 20, examples: ['luna-lamp'] },
  { path: 'inventory.available', type: 'int32', typeDistribution: { int32: 18, int64: 2 }, count: 20, examples: [18, 83] },
  { path: 'inventory.reserved', type: 'int32', typeDistribution: { int32: 18 }, count: 18, examples: [4, 1] },
]

describe('MongoSchemaView', () => {
  it('renders schema field paths, type distributions, presence, and warnings', () => {
    render(
      <MongoSchemaView
        descriptor={descriptor}
        payload={{
          database: 'catalog',
          collection: 'products',
          sampleSize: 20,
          fields,
        }}
      />,
    )

    expect(screen.getByText('inventory.available')).toBeInTheDocument()
    expect(screen.getByText('int32 (18), int64 (2)')).toBeInTheDocument()
    expect(screen.getAllByText('20/20 (100%)').length).toBeGreaterThan(0)
    expect(screen.getByText('18/20 (90%)')).toBeInTheDocument()
    expect(screen.getByText('Mixed BSON types')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('plans validator generation through guarded operation requests', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoSchemaView
        descriptor={descriptor}
        payload={{
          database: 'catalog',
          collection: 'products',
          sampleSize: 20,
          fields,
        }}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Validator' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.validation.update',
      objectName: 'products',
      parameters: expect.objectContaining({
        collection: 'products',
        validator: expect.objectContaining({
          $jsonSchema: expect.objectContaining({
            required: expect.arrayContaining(['sku']),
          }),
        }),
      }),
    }))
  })

  it('normalizes field helper output consistently', () => {
    expect(fieldTypesText({ typeDistribution: { string: 2, int32: 1 } })).toBe('string (2), int32 (1)')
    expect(fieldPresenceText({ count: 3 }, 4)).toBe('3/4 (75%)')
    expect(fieldWarningsText({ typeDistribution: { string: 2, int32: 1 }, count: 3 }, 4))
      .toBe('Mixed BSON types, Missing from some documents')
    expect(generateValidatorFromFields(fields, 20)).toEqual({
      $jsonSchema: expect.objectContaining({
        bsonType: 'object',
        required: expect.arrayContaining(['sku']),
        properties: expect.objectContaining({
          sku: { bsonType: 'string' },
          inventory: expect.objectContaining({
            bsonType: 'object',
          }),
        }),
      }),
    })
  })
})
