import { describe, expect, it } from 'vitest'
import {
  datastoreDocRoutes,
  datastoreDocs,
  datastoreDocsByFamily,
  datastoreGuideLinksByArticleSlug,
  declaredDatastoreEngines,
  getDatastoreDocByName,
  getDatastoreDocBySlug,
  type DatastoreDoc,
} from './datastores'
import { datastoreGroups } from './product'
import { datastoreTransferManifest } from '../../../desktop/src/services/runtime/datastore-transfer-manifests'
import { transferSupportMatrix } from './transfer-docs'
import { screenshotSlots } from './screenshots'
import { CONNECTION_EDITOR_CATALOG } from '@datapadplusplus/shared-types'

const requiredSections: Array<
  keyof Pick<
    DatastoreDoc,
    | 'connections'
    | 'explorer'
    | 'queryModes'
    | 'resultViews'
    | 'adminFeatures'
    | 'diagnostics'
    | 'importExport'
    | 'safety'
  >
> = ['connections', 'explorer', 'queryModes', 'resultViews', 'adminFeatures', 'diagnostics', 'importExport', 'safety']

describe('datastore documentation', () => {
  it('uses the connection catalogue for every method, optional field, and runtime limitation', () => {
    for (const doc of datastoreDocs) {
      const capability = CONNECTION_EDITOR_CATALOG[doc.engine]
      const fieldNames = doc.connectionFields.map(field => field.name)
      expect(fieldNames, doc.engine).toEqual(expect.arrayContaining(capability.fields.map(field => field.label)))
      expect(doc.connections, doc.engine).toEqual(expect.arrayContaining(capability.limitations))
      expect(doc.connectionFields.some(field => field.name === 'Complete connection string'), doc.engine)
        .toBe(capability.methods.includes('connection-string'))
      expect(doc.connectionFields.some(field => field.name === 'Database file'), doc.engine).toBe(Boolean(capability.local))
      if (capability.status === 'local-only') {
        expect(doc.connections.join(' '), doc.engine).toContain('not full managed-cloud connectivity')
        expect(doc.connections.join(' '), doc.engine).not.toMatch(/Application Default Credentials|configure.+assume-role/i)
      }
    }
  })

  it('explains the current local-file and MongoDB connection boundaries', () => {
    for (const engine of ['sqlite', 'duckdb', 'litedb']) {
      const guide = getDatastoreDocBySlug(engine)!
      expect(guide.connections.join(' ')).toContain('Create new database')
      expect(guide.connections.join(' ')).toContain('Open existing database')
    }
    expect(getDatastoreDocBySlug('litedb')!.connections.join(' ')).toContain('not currently bundled')
    expect(getDatastoreDocBySlug('mongodb')!.connections.join(' ')).toContain('Studio 3T')
    expect(getDatastoreDocBySlug('mongodb')!.connections.join(' ')).toContain('unchanged')
  })

  it('has one docs page for every declared datastore engine', () => {
    const documentedEngines = datastoreDocs.map((doc) => doc.engine).sort()
    const declaredEngines = [...declaredDatastoreEngines].sort()

    expect(documentedEngines).toEqual(declaredEngines)
    expect(new Set(documentedEngines).size).toBe(documentedEngines.length)
  })

  it('uses stable unique slugs and generated docs routes', () => {
    const slugs = datastoreDocs.map((doc) => doc.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
    expect(datastoreDocRoutes).toContain('/docs/datastores/postgresql')
    expect(datastoreDocRoutes).toContain('/docs/datastores/neptune')
    expect(datastoreDocRoutes.every((route) => route.startsWith('/docs/datastores/'))).toBe(true)
  })

  it('keeps required datastore-specific sections populated', () => {
    for (const doc of datastoreDocs) {
      expect(doc.title).toBeTruthy()
      expect(doc.family).toBeTruthy()
      expect(doc.maturity).toBeTruthy()
      expect(doc.summary).toBeTruthy()
      expect(doc.bestFor.length).toBeGreaterThanOrEqual(2)
      expect(doc.screenshots.length).toBeGreaterThanOrEqual(5)
      expect(doc.prerequisites.length).toBeGreaterThanOrEqual(3)
      expect(doc.quickstart).toHaveLength(8)
      expect(doc.connectionFields.length).toBeGreaterThanOrEqual(3)
      expect(doc.sampleQuery.length).toBeGreaterThan(8)
      expect(doc.expectedResult.length).toBeGreaterThan(8)
      expect(doc.capabilities.length).toBeGreaterThanOrEqual(5)
      expect(doc.troubleshooting.length).toBeGreaterThanOrEqual(4)

      for (const section of requiredSections) {
        expect(doc[section].length, `${doc.title} ${section}`).toBeGreaterThan(0)
      }
    }
  })

  it('has unique connection and workflow captures plus explicit shared assets', () => {
    for (const doc of datastoreDocs) {
      expect(doc.screenshots[0]?.id).toBe(`datastore-${doc.engine}-connection`)
      expect(doc.screenshots[1]?.id).toBe(`datastore-${doc.engine}-workflow`)
      for (const screenshot of doc.screenshots) {
        expect(screenshotSlots[screenshot.id], `${doc.engine} -> ${screenshot.id}`).toBeTruthy()
      }
      expect(doc.screenshots.slice(2).every((screenshot) => screenshot.shared === true)).toBe(true)
    }
  })

  it('keeps the product coverage names represented by datastore docs', () => {
    const documentedNames = new Set(datastoreDocs.flatMap((doc) => [doc.title, ...(doc.aliases ?? [])]))
    const productNames = new Set(datastoreGroups.flatMap((group) => group.engines))

    for (const name of productNames) {
      expect(documentedNames.has(name), name).toBe(true)
    }
  })

  it('maps every product coverage entry to its datastore documentation route', () => {
    const linkedRoutes = datastoreGroups.flatMap((group) =>
      group.engines.map((name) => {
        const doc = getDatastoreDocByName(name)

        expect(doc, name).toBeTruthy()
        return `/docs/datastores/${doc?.slug}`
      }),
    )

    expect(linkedRoutes).toHaveLength(datastoreGroups.flatMap((group) => group.engines).length)
    expect(new Set(linkedRoutes).size).toBe(datastoreDocs.length)
    expect(linkedRoutes.every((route) => datastoreDocRoutes.includes(route))).toBe(true)
    expect(getDatastoreDocByName('SQL Server')?.slug).toBe('sqlserver')
    expect(getDatastoreDocByName('Azure SQL')?.slug).toBe('sqlserver')
  })

  it('groups datastore docs without losing entries', () => {
    const groupedSlugs = datastoreDocsByFamily.flatMap((group) => group.docs.map((doc) => doc.slug)).sort()
    const allSlugs = datastoreDocs.map((doc) => doc.slug).sort()

    expect(groupedSlugs).toEqual(allSlugs)
  })

  it('links grouped launch docs only to existing datastore pages', () => {
    const linkedSlugs = Object.values(datastoreGuideLinksByArticleSlug).flat()

    for (const slug of linkedSlugs) {
      expect(getDatastoreDocBySlug(slug)?.slug).toBe(slug)
    }
  })

  it('derives every transfer action from the authoritative runtime manifest', () => {
    for (const doc of datastoreDocs) {
      const manifest = datastoreTransferManifest(doc.engine)
      const support = transferSupportMatrix(doc.engine)

      expect(doc.importExport).toHaveLength(manifest.capabilities.length)

      for (const capability of manifest.capabilities) {
        expect(support[capability.action]).toBe(capability.executionSupport)
        const actionLabel = `${capability.action.charAt(0).toUpperCase()}${capability.action.slice(1)}`
        expect(doc.importExport.some((line) => line.startsWith(`${actionLabel} —`))).toBe(true)
        for (const format of capability.formats) {
          expect(doc.importExport.some((line) => line.includes(format.label))).toBe(true)
        }
      }
    }
  })
})
