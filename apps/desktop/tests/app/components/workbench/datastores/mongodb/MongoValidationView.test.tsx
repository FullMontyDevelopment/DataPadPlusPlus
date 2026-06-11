import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoValidationView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoValidationView'
import { mongoValidationViewKey } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoValidationView.helpers'

const descriptor = getMongoObjectViewDescriptor('validation-rules')

describe('MongoValidationView', () => {
  it('tests draft documents against required fields locally', () => {
    render(
      <MongoValidationView
        descriptor={descriptor}
        payload={{
          database: 'catalog',
          collection: 'products',
          validator: { $jsonSchema: { required: ['sku', 'name'] } },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Test document'), {
      target: { value: '{ "sku": "luna-lamp" }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test Document' }))
    expect(screen.getByText('Missing required field(s): name')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Test document'), {
      target: { value: '{ "sku": "luna-lamp", "name": "Luna Lamp" }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test Document' }))
    expect(screen.getByText('Document matches the validator fields DataPad++ can verify locally.')).toBeInTheDocument()
  })

  it('reviews required-field changes without showing raw JSON first', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoValidationView
        descriptor={descriptor}
        payload={{
          database: 'catalog',
          collection: 'products',
          validator: { $jsonSchema: { required: ['sku'] } },
        }}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('Advanced JSON rule').closest('details')).not.toHaveAttribute('open')
    fireEvent.change(screen.getByPlaceholderText('sku'), { target: { value: 'name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Required Fields' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.validation.update',
      objectName: 'products',
      parameters: expect.objectContaining({
        validator: expect.objectContaining({
          $jsonSchema: expect.objectContaining({
            required: ['sku', 'name'],
          }),
        }),
      }),
    }))
  })

  it('uses a stable remount key when validator payloads change', () => {
    const firstPayload = {
      database: 'catalog',
      collection: 'products',
      validator: { $jsonSchema: { required: ['sku'] } },
    }
    const nextPayload = {
      database: 'catalog',
      collection: 'products',
      validator: { $jsonSchema: { required: ['sku', 'name'] } },
    }

    expect(mongoValidationViewKey(firstPayload)).not.toBe(mongoValidationViewKey(nextPayload))
  })
})
