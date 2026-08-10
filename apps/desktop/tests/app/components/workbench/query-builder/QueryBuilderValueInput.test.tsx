import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryBuilderValueInput } from '../../../../../src/app/components/workbench/query-builder/QueryBuilderValueInput'

describe('QueryBuilderValueInput', () => {
  it('uses an explicit boolean selector', () => {
    const onChange = vi.fn()
    render(
      <QueryBuilderValueInput
        ariaLabel="Boolean value"
        theme="dark"
        value=""
        valueType="boolean"
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Boolean value'), { target: { value: 'false' } })
    expect(onChange).toHaveBeenCalledWith('false')
  })

  it('converts the local date-time picker value to a UTC ISO value', () => {
    const onChange = vi.fn()
    render(
      <QueryBuilderValueInput
        ariaLabel="Date value"
        theme="dark"
        value="2026-08-09T00:00:00.000Z"
        valueType="date"
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Date value date picker'), {
      target: { value: '2026-08-09T12:30' },
    })
    expect(onChange).toHaveBeenCalledWith(new Date('2026-08-09T12:30').toISOString())
  })

  it('requires the current JSON dialog draft to pass explicit validation before applying', () => {
    const onChange = vi.fn()
    render(
      <QueryBuilderValueInput
        ariaLabel="JSON value"
        theme="dark"
        value="{bad"
        valueType="json"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open JSON editor' }))
    const editor = screen.getByLabelText('JSON value JSON editor')
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
    expect(screen.getAllByRole('alert')).not.toHaveLength(0)
    expect(apply).toBeDisabled()

    fireEvent.change(editor, { target: { value: '{"answer":42}' } })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
    expect(screen.getByRole('status')).toHaveTextContent('passed validation')
    expect(apply).not.toBeDisabled()
    fireEvent.click(apply)
    expect(onChange).toHaveBeenCalledWith('{"answer":42}')
  })

  it('renders no value control for unary operators', () => {
    render(
      <QueryBuilderValueInput
        ariaLabel="Unary value"
        operator="has-items"
        theme="dark"
        value="stale"
        valueType="string"
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Unary value')).not.toBeInTheDocument()
  })

  it('marks invalid values so the host row can keep its controls top-aligned', () => {
    const { rerender } = render(
      <QueryBuilderValueInput
        ariaLabel="Array length"
        operator="has-length"
        theme="dark"
        value=""
        valueType="number"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Array length').closest('.query-builder-typed-value')).toHaveClass('has-error')
    expect(screen.getByRole('alert')).toHaveTextContent('non-negative whole-number')

    rerender(
      <QueryBuilderValueInput
        ariaLabel="Array length"
        operator="has-length"
        theme="dark"
        value="2"
        valueType="number"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Array length').closest('.query-builder-typed-value')).not.toHaveClass('has-error')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
