import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MongoScriptWorkspace } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoScriptWorkspace'

describe('MongoScriptWorkspace', () => {
  it('searches the guide, inserts examples, and supports keyboard resizing', async () => {
    const onChange = vi.fn()
    const onGuideWidthChange = vi.fn()
    render(
      <MongoScriptWorkspace
        value=""
        theme="dark"
        database="catalog"
        collection="products"
        guideVisible
        guideWidth={360}
        onChange={onChange}
        onGuideWidthChange={onGuideWidthChange}
      />,
    )

    expect(screen.getByRole('complementary', { name: 'MongoDB scripting guide' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search MongoDB scripting guide' }), {
      target: { value: 'countDocuments' },
    })
    expect(screen.getByText('collection.countDocuments(filter, options)')).toBeInTheDocument()
    expect(screen.queryByText('collection.bulkWrite(models, options)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Insert example' }))
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        'db.getCollection("products").countDocuments({ status: "active" })',
      )
    })

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize MongoDB scripting guide' }), {
      key: 'ArrowLeft',
    })
    expect(onGuideWidthChange).toHaveBeenCalledWith(376)
  })

  it('keeps the guide out of the editor layout when hidden', () => {
    render(
      <MongoScriptWorkspace
        value="db.products.find({})"
        theme="dark"
        guideVisible={false}
        guideWidth={360}
        onChange={vi.fn()}
        onGuideWidthChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('complementary', { name: 'MongoDB scripting guide' })).not.toBeInTheDocument()
  })

  it('documents plain text and console logging', () => {
    render(
      <MongoScriptWorkspace
        value=""
        theme="dark"
        guideVisible
        guideWidth={360}
        onChange={vi.fn()}
        onGuideWidthChange={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search MongoDB scripting guide' }), {
      target: { value: 'logging' },
    })

    expect(screen.getByText('console.log(...values)')).toBeInTheDocument()
    expect(screen.getByText(/console\.info/)).toBeInTheDocument()
  })
})
