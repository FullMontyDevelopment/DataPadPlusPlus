import { describe, expect, it } from 'vitest'
import {
  docArticles,
  docCategories,
  docNavigationGroups,
  documentedNavigationSurfaces,
  getDocBySlug,
  navigationSurfaceArticle,
  type DocBlock,
} from './docs'
import { screenshotSlots } from './screenshots'
import { getDatastoreDocBySlug } from './datastores'

function blocks(articleSlug: string) {
  return getDocBySlug(articleSlug)?.sections.flatMap((section) => section.blocks) ?? []
}

function screenshotIds(block: DocBlock) {
  if (block.type === 'figure') return [block.screenshot]
  if (block.type === 'procedure') return block.steps.flatMap((step) => step.figure ? [step.figure] : [])
  return []
}

describe('docs content', () => {
  it('preserves 33 routes and adds the eight focused guides', () => {
    const slugs = docArticles.map((article) => article.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs).toHaveLength(41)
    expect(slugs).toEqual(expect.arrayContaining([
      'interface-tour', 'first-query', 'tabs-panels-and-drawers', 'connection-health',
      'query-history-explain', 'metrics-and-inspection', 'transfers-center', 'appearance-shortcuts-logs',
    ]))
  })

  it('uses typed sections and only registered figures', () => {
    const knownSlots = new Set(Object.keys(screenshotSlots))
    for (const article of docArticles) {
      expect(article.sections.length, article.slug).toBeGreaterThanOrEqual(4)
      expect(new Set(article.sections.map((section) => section.id)).size, article.slug).toBe(article.sections.length)
      expect(article.sections.every((section) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section.id)), article.slug).toBe(true)
      expect(article.sections.map((section) => section.id)).toContain('quickstart')
      expect(article.sections.map((section) => section.id)).toContain('safety-boundaries')
      const figures = article.sections.flatMap((section) => section.blocks.flatMap(screenshotIds))
      expect(figures.filter((id) => !knownSlots.has(id)), article.slug).toEqual([])
      expect(article.sections.flatMap((section) => section.blocks).some((block) => block.type === 'procedure'), article.slug).toBe(true)
    }
  })

  it('organizes every article once in the Learn-style hierarchy', () => {
    const navigationSlugs = docNavigationGroups.flatMap((group) => group.slugs)
    expect(new Set(navigationSlugs).size).toBe(navigationSlugs.length)
    expect([...navigationSlugs].sort()).toEqual(docArticles.map((article) => article.slug).sort())
    expect(docNavigationGroups.map((group) => group.label)).toEqual([
      'Start here', 'Connections and organization', 'Navigate and inspect', 'Query and edit',
      'Move and protect data', 'Automate and diagnose', 'Safety and troubleshooting', 'Datastore guides',
    ])
    expect(docCategories).toContain('Getting started')
  })

  it('maps every declared navigation surface to published content', () => {
    for (const surface of documentedNavigationSurfaces) {
      const articleSlug = navigationSurfaceArticle[surface]
      expect(getDocBySlug(articleSlug)?.slug, `${surface} -> ${articleSlug}`).toBe(articleSlug)
    }
  })

  it('keeps related guide and datastore links valid', () => {
    for (const article of docArticles) {
      for (const relatedSlug of article.relatedGuides ?? []) {
        expect(getDocBySlug(relatedSlug)?.slug, `${article.slug} -> ${relatedSlug}`).toBe(relatedSlug)
      }
      for (const engine of article.appliesTo ?? []) {
        expect(getDatastoreDocBySlug(engine)?.engine, `${article.slug} -> ${engine}`).toBe(engine)
      }
    }
  })

  it('labels live, experimental, and unavailable boundaries inside rich content', () => {
    expect(getDocBySlug('workspace-import-export')?.status).toBe('Live')
    expect(getDocBySlug('native-datastore-transfers')?.status).toBe('Live')
    expect(getDocBySlug('multi-window-tabs')?.status).toBe('Experimental')
    expect(JSON.stringify(blocks('multi-window-tabs'))).toContain('Cross-window dragging')
  })

  it('provides complete screenshot metadata', () => {
    for (const slot of Object.values(screenshotSlots)) {
      expect(slot.title.length).toBeGreaterThan(4)
      expect(slot.alt.length).toBeGreaterThan(20)
      expect(slot.caption.length).toBeGreaterThan(20)
      expect(slot.image).toMatch(/^\/screenshots\/.+\.png$/)
      expect(slot.captureCase.length).toBeGreaterThan(8)
    }
  })
})
