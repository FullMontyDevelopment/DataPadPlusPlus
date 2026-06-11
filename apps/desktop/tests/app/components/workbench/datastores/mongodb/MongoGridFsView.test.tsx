import { fireEvent, render, screen } from '@testing-library/react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { MongoGridFsView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoGridFsView'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'

const descriptor = getMongoObjectViewDescriptor('gridfs-files')

const gridFsPayload = {
  database: 'catalog',
  bucket: 'fs',
  filesCollection: 'fs.files',
  chunksCollection: 'fs.chunks',
  missingChunkCount: 1,
  buckets: [{ bucket: 'fs', filesCollection: 'fs.files', chunksCollection: 'fs.chunks' }],
  files: [{
    filename: 'invoice.pdf',
    length: 2048,
    uploadDate: '2026-05-20T10:00:00Z',
    metadata: { tenant: 'qa' },
  }],
  chunks: [{ files_id: 'file-1', n: 0, size: 1024 }],
}

describe('MongoGridFsView', () => {
  it('renders GridFS health and metadata without dumping the raw payload', () => {
    render(
      <MongoGridFsView
        descriptor={descriptor}
        payload={gridFsPayload}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('GridFS Browser')).toBeInTheDocument()
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getAllByText(/2(\.0)? KB/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1(\.0)? KB/)).toBeInTheDocument()
    expect(screen.getByText('Missing chunks')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('plans export, upload, and chunk validation through guarded operation requests', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoGridFsView
        descriptor={descriptor}
        payload={gridFsPayload}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export Files' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.export',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        database: 'catalog',
        bucket: 'fs',
        filename: 'invoice.pdf',
        filesCollection: 'fs.files',
        chunksCollection: 'fs.chunks',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.upload',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        source: '<selected-file>',
        validation: 'validate-before-write',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Validate Chunks' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.validate',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        database: 'catalog',
        bucket: 'fs',
      }),
    }))
  })

  it('opens a scoped GridFS query when a query target is supplied', () => {
    const onOpenQuery = vi.fn()
    const queryTarget: ScopedQueryTarget = {
      kind: 'gridfs-files',
      label: 'fs.files',
      path: ['catalog', 'GridFS'],
      queryTemplate: '{ "database": "catalog", "collection": "fs.files", "filter": {}, "limit": 20 }',
      preferredBuilder: 'mongo-find',
    }

    render(
      <MongoGridFsView
        descriptor={descriptor}
        payload={gridFsPayload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Query GridFS Collection' }))
    expect(onOpenQuery).toHaveBeenCalledWith(queryTarget)
  })
})
