import { beforeEach, describe, expect, it } from 'vitest'
import { datastoreDocs } from '../data/datastores'
import { docArticles } from '../data/docs'
import { applySeoMetadata, getSitePage, normalizeSitePath, renderLlmsIndex, renderSeoHead, renderSitemap, seoMetadata, sitePages, structuredData } from './seo'

describe('canonical website metadata and discovery', () => {
  it('covers every workflow and all 29 engines exactly once', () => {
    expect(datastoreDocs).toHaveLength(29)
    expect(sitePages).toHaveLength(7 + docArticles.length + datastoreDocs.length)
    expect(new Set(sitePages.map((page) => page.path)).size).toBe(sitePages.length)
    expect(new Set(sitePages.map((page) => page.title)).size).toBe(sitePages.length)
    expect(new Set(sitePages.map((page) => page.description)).size).toBe(sitePages.length)
    for (const doc of datastoreDocs) expect(getSitePage(`/docs/datastores/${doc.slug}`)?.title).toContain(doc.title)
    for (const doc of docArticles) expect(getSitePage(`/docs/${doc.slug}`)?.description).toBe(doc.description)
  })

  it.each(['/download', '/downloads', '/download/', '/downloads/?ref=old#install'])('canonicalizes download aliases: %s', (path) => {
    expect(seoMetadata(path).canonical).toBe('https://datapad-plus-plus.org/download')
  })

  it('does not leak search terms or tracking parameters into canonical URLs', () => {
    expect(normalizeSitePath('/docs/first-query/?q=password&utm_source=test#quickstart')).toBe('/docs/first-query')
    expect(renderSeoHead('/docs/first-query?q=private-term')).not.toContain('private-term')
  })

  it.each(['/unknown', '/docs/missing', '/docs/datastores/missing', '//evil.example', '/docs/../safety', '/404'])('rejects unknown routes without a homepage fallback: %s', (path) => {
    const metadata = seoMetadata(path)
    expect(metadata.canonical).toBeUndefined()
    expect(metadata.structured).toBeUndefined()
    expect(renderSeoHead(path)).toContain('noindex, follow')
    expect(renderSeoHead(path)).not.toContain('rel="canonical"')
  })

  it('emits real application facts and breadcrumbs, not invented ratings, offers or dates', () => {
    const home = structuredData(getSitePage('/')!)
    expect(home['@graph'].some((node) => node['@type'] === 'SoftwareApplication')).toBe(true)
    expect(JSON.stringify(home)).not.toMatch(/aggregateRating|offers|dateModified|datePublished/)
    const guide = structuredData(getSitePage('/docs/datastores/mongodb')!)
    const breadcrumbs = guide['@graph'].find((node) => node['@type'] === 'BreadcrumbList')
    expect(breadcrumbs?.itemListElement).toEqual(expect.arrayContaining([expect.objectContaining({ position: 3, item: 'https://datapad-plus-plus.org/docs/datastores' })]))
    expect(guide['@graph'].some((node) => node['@type'] === 'TechArticle')).toBe(true)
  })

  it('escapes HTML and script delimiters in authored metadata', () => {
    const page = getSitePage('/')!
    const original = page.description
    try {
      page.description = 'Quotes " and <script></script> & markup'
      const head = renderSeoHead('/')
      expect(head).toContain('&quot; and &lt;script&gt;')
      expect(head).toContain('\\u003c/script>')
      expect(head.match(/<\/script>/g)).toHaveLength(1)
    } finally { page.description = original }
  })

  it('generates sitemap and optional AI index from the same canonical catalog', () => {
    const sitemap = renderSitemap()
    const llms = renderLlmsIndex()
    expect(sitemap.match(/<loc>/g)).toHaveLength(sitePages.length)
    expect(sitemap).not.toMatch(/<lastmod>|\/downloads<|\/404</)
    expect(llms).toContain('not for production workloads')
    for (const page of sitePages) {
      expect(sitemap).toContain(`https://datapad-plus-plus.org${page.path}</loc>`)
      expect(llms).toContain(`https://datapad-plus-plus.org${page.path})`)
    }
  })
})

describe('browser metadata parity', () => {
  beforeEach(() => { document.head.innerHTML = '' })

  it('updates titles, descriptions, social metadata and canonical URLs without duplicating tags', () => {
    applySeoMetadata('/')
    applySeoMetadata('/docs/first-query?q=test')
    applySeoMetadata('/docs/first-query')
    expect(document.title).toBe(getSitePage('/docs/first-query')!.title)
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://datapad-plus-plus.org/docs/first-query')
    expect(document.querySelectorAll('#site-structured-data')).toHaveLength(1)
  })

  it('removes previous canonical and structured data on a missing route and restores them on return', () => {
    applySeoMetadata('/docs/first-query')
    applySeoMetadata('/missing')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('meta[property="og:url"]')).toBeNull()
    expect(document.querySelector('#site-structured-data')).toBeNull()
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow')
    applySeoMetadata('/features')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('index, follow')
    expect(document.querySelector('#site-structured-data')).not.toBeNull()
  })
})
