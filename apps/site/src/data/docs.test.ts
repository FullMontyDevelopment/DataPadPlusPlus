import { describe, expect, it } from 'vitest'
import { docArticles, docCategories, getDocBySlug } from './docs'
import { screenshotSlots } from './screenshots'
import { getDatastoreDocBySlug } from './datastores'

describe('docs content', () => {
  it('has unique slugs', () => {
    const slugs = docArticles.map((article) => article.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('references only known screenshot placeholders', () => {
    const knownSlots = new Set(Object.keys(screenshotSlots))
    const missing = docArticles.flatMap((article) =>
      article.screenshots.filter((screenshot) => !knownSlots.has(screenshot)),
    )

    expect(missing).toEqual([])
  })

  it('keeps every article step-by-step', () => {
    expect(docArticles.length).toBeGreaterThanOrEqual(12)
    expect(docArticles.every((article) => article.steps.length >= 5)).toBe(true)
  })

  it('organizes canonical guides around user journeys', () => {
    expect(docCategories).toEqual(expect.arrayContaining([
      'Getting started',
      'Connections, environments, and secrets',
      'Workspaces, backups, and recovery',
      'Exploring and IntelliSense',
      'Querying and query builders',
      'Results and safe editing',
      'Import, export, and native backup',
      'Experimental features',
      'Integrations and automation',
      'Datastore-specific guides',
    ]))
  })

  it('keeps related guide links valid', () => {
    for (const article of docArticles) {
      for (const relatedSlug of article.relatedGuides ?? []) {
        expect(getDocBySlug(relatedSlug)?.slug, `${article.slug} -> ${relatedSlug}`).toBe(relatedSlug)
      }
    }
  })

  it('labels new live and experimental workflows', () => {
    expect(getDocBySlug('workspace-import-export')?.status).toBe('Live')
    expect(getDocBySlug('native-datastore-transfers')?.status).toBe('Live')
    expect(getDocBySlug('multi-window-tabs')?.status).toBe('Experimental')
    expect(getDocBySlug('multi-window-tabs')?.warning).toContain('Cross-window dragging')
  })

  it('references only documented datastore engines', () => {
    for (const article of docArticles) {
      for (const engine of article.appliesTo ?? []) {
        expect(getDatastoreDocBySlug(engine)?.engine, `${article.slug} -> ${engine}`).toBe(engine)
      }
    }
  })

  it('keeps screenshot metadata descriptive', () => {
    for (const slot of Object.values(screenshotSlots)) {
      expect(slot.title.length).toBeGreaterThan(4)
      expect(slot.caption.length).toBeGreaterThan(20)
    }
  })
})
