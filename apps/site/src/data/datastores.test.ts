import { describe, expect, it } from 'vitest'
import {
  datastoreDocRoutes,
  datastoreDocs,
  datastoreDocsByFamily,
  datastoreGuideLinksByArticleSlug,
  declaredDatastoreEngines,
  getDatastoreDocBySlug,
  type DatastoreDoc,
} from './datastores'
import { datastoreGroups } from './product'

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

      for (const section of requiredSections) {
        expect(doc[section].length, `${doc.title} ${section}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the product coverage names represented by datastore docs', () => {
    const documentedNames = new Set(datastoreDocs.flatMap((doc) => [doc.title, ...(doc.aliases ?? [])]))
    const productNames = new Set(datastoreGroups.flatMap((group) => group.engines))

    for (const name of productNames) {
      expect(documentedNames.has(name), name).toBe(true)
    }
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
})
