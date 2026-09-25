import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MongoDocumentInsertPanel } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoDocumentInsertPanel'

describe('MongoDB document upload sizes', () => {
  it('loads a >16 MiB JSON file when whitespace, not document data, accounts for its size', async () => {
    const document = { name: 'large source, small BSON' }
    const text = ' '.repeat(16 * 1024 * 1024) + JSON.stringify(document)
    const file = new File([text], 'document.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) })
    const onInsertDocument = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<MongoDocumentInsertPanel collection="items" requiredFields={[]} onInsertDocument={onInsertDocument} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
    await screen.findByText('Loaded document.json.')
    fireEvent.click(screen.getByRole('button', { name: 'Insert Document' }))
    await waitFor(() => expect(onInsertDocument).toHaveBeenCalledWith(document))
  })

  it('retains the draft and reports native size rejection without claiming success', async () => {
    const onInsertDocument = vi.fn().mockRejectedValue(new Error('Encoded BSON exceeds 16 MiB.'))
    render(<MongoDocumentInsertPanel collection="items" requiredFields={[]} onInsertDocument={onInsertDocument} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"name":"keep my draft"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert Document' }))
    await screen.findByText('Encoded BSON exceeds 16 MiB.')
    expect(screen.getByRole('textbox')).toHaveValue('{"name":"keep my draft"}')
    expect(screen.queryByText('Insert request sent.')).not.toBeInTheDocument()
  })
})
