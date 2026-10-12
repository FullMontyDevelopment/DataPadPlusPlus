import { docArticles } from '../data/docs'
import { datastoreDocs } from '../data/datastores'
import { repoUrl, websiteUrl } from '../data/product'

export type SitePage = {
  path: string
  title: string
  description: string
  kind: 'website' | 'article'
  breadcrumbs: { name: string; path: string }[]
}

const home = { name: 'DataPad++', path: '/' }
const docs = { name: 'Documentation', path: '/docs' }
const datastores = { name: 'Datastore guides', path: '/docs/datastores' }
const primaryPages: [string, string, string][] = [
  ['/', 'DataPad++ | SQL, NoSQL and database workbench', 'Explore SQL, MongoDB, Redis and 29 datastore engines in one desktop workbench for Windows, macOS and Linux. Pre-release; not for production workloads.'],
  ['/features', 'Database tools, query builders and workflows | DataPad++', 'Explore native datastore tools, typed query builders, result editing, transfers, workspace backups and integrations in the DataPad++ desktop workbench.'],
  ['/coverage', '29 SQL, NoSQL and other datastore engines | DataPad++', 'Compare DataPad++ datastore coverage across SQL, document, key-value, search, graph, analytical and time-series engines, including capability limitations.'],
  ['/download', 'Download DataPad++ for Windows, macOS and Linux', 'Get the latest DataPad++ desktop installers and release notes for Windows, macOS and Linux. Pre-release software: use disposable or read-only systems.'],
  ['/safety', 'Pre-release safety, secrets and guardrails | DataPad++', 'Understand DataPad++ safety boundaries, read-only connections, secrets, guarded edits and independent backups. Do not use it for production workloads.'],
  ['/docs', 'DataPad++ documentation and step-by-step guides', 'Learn to connect, query, inspect results, organize workspaces and transfer data with DataPad++ guides, plugin instructions and datastore-specific tutorials.'],
  ['/docs/datastores', 'Datastore connection and query guides | DataPad++', 'Follow connection, query, result, transfer and troubleshooting guides for all 29 DataPad++ datastore engines, with native capabilities and safety limits.'],
]

export const sitePages: SitePage[] = [
  ...primaryPages.map(([path, title, description]) => ({
    path, title, description, kind: 'website' as const,
    breadcrumbs: path === '/' ? [home] : path === datastores.path ? [home, docs, datastores] : [home, { name: title.split(' | ')[0]!, path }],
  })),
  ...docArticles.map((article) => ({
    path: `/docs/${article.slug}`, title: `${article.title} | DataPad++`, description: article.description,
    kind: 'article' as const, breadcrumbs: [home, docs, { name: article.title, path: `/docs/${article.slug}` }],
  })),
  ...datastoreDocs.map((doc) => ({
    path: `/docs/datastores/${doc.slug}`, title: `${doc.title} connection and query guide | DataPad++`, description: doc.summary,
    kind: 'article' as const, breadcrumbs: [home, docs, datastores, { name: doc.title, path: `/docs/datastores/${doc.slug}` }],
  })),
]

const pageByPath = new Map(sitePages.map((page) => [page.path, page]))
export const socialImage = new URL('/screenshots/sql-query-results.png', websiteUrl).href
export const socialImageAlt = 'DataPad++ desktop workbench with a SQL query, environment context and result grid.'

export function normalizeSitePath(pathname: string): string {
  // Match only known local paths; query strings and fragments never enter canonical URLs.
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
  return path === '/downloads' ? '/download' : path
}

export function getSitePage(pathname: string): SitePage | undefined {
  return pageByPath.get(normalizeSitePath(pathname))
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function structuredData(page: SitePage) {
  const url = new URL(page.path, websiteUrl).href
  const organizationId = `${websiteUrl}#organization`
  const websiteId = `${websiteUrl}#website`
  const nodes: Record<string, unknown>[] = [
    { '@type': 'Organization', '@id': organizationId, name: 'FullMontyDevelopment', url: repoUrl.replace('/DataPadPlusPlus', ''), sameAs: [repoUrl.replace('/DataPadPlusPlus', '')] },
    { '@type': 'WebSite', '@id': websiteId, name: 'DataPad++', url: websiteUrl, inLanguage: 'en', publisher: { '@id': organizationId } },
    {
      '@type': page.kind === 'article' ? 'TechArticle' : 'WebPage', '@id': `${url}#page`, url,
      name: page.title, ...(page.kind === 'article' ? { headline: page.breadcrumbs.at(-1)!.name } : {}),
      description: page.description, inLanguage: 'en', isPartOf: { '@id': websiteId },
      publisher: { '@id': organizationId }, image: socialImage,
    },
  ]
  if (page.path === '/') {
    nodes.push({
      '@type': 'SoftwareApplication', '@id': `${websiteUrl}#application`, name: 'DataPad++',
      applicationCategory: 'DeveloperApplication', operatingSystem: 'Windows, macOS, Linux',
      url: websiteUrl, downloadUrl: new URL('/download', websiteUrl).href, screenshot: socialImage,
      description: page.description, publisher: { '@id': organizationId }, sameAs: [repoUrl],
    })
  }
  if (page.breadcrumbs.length > 1) {
    nodes.push({ '@type': 'BreadcrumbList', itemListElement: page.breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem', position: index + 1, name: crumb.name, item: new URL(crumb.path, websiteUrl).href,
    })) })
  }
  return { '@context': 'https://schema.org', '@graph': nodes }
}

export function seoMetadata(pathname: string) {
  const page = getSitePage(pathname)
  const title = page?.title ?? 'Page not found | DataPad++'
  const description = page?.description ?? 'This DataPad++ page could not be found. Browse the documentation or return to the product home page.'
  const canonical = page ? new URL(page.path, websiteUrl).href : undefined
  const metas = [
    { name: 'description', content: description },
    { name: 'robots', content: page ? 'index, follow, max-image-preview:large' : 'noindex, follow' },
    { property: 'og:type', content: page?.kind ?? 'website' },
    { property: 'og:site_name', content: 'DataPad++' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    ...(canonical ? [{ property: 'og:url', content: canonical }] : []),
    { property: 'og:image', content: socialImage },
    { property: 'og:image:width', content: '1584' },
    { property: 'og:image:height', content: '961' },
    { property: 'og:image:alt', content: socialImageAlt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: socialImage },
    { name: 'twitter:image:alt', content: socialImageAlt },
  ]
  return { title, canonical, metas, structured: page ? structuredData(page) : undefined }
}

export function renderSeoHead(pathname: string): string {
  const metadata = seoMetadata(pathname)
  return [
    `<title>${escapeHtml(metadata.title)}</title>`,
    ...metadata.metas.map((meta) => `<meta ${'name' in meta ? `name="${meta.name}"` : `property="${meta.property}"`} content="${escapeHtml(meta.content)}" />`),
    ...(metadata.canonical ? [`<link rel="canonical" href="${escapeHtml(metadata.canonical)}" />`] : []),
    ...(metadata.structured ? [`<script type="application/ld+json" id="site-structured-data">${JSON.stringify(metadata.structured).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n')
}

export function applySeoMetadata(pathname: string): void {
  const metadata = seoMetadata(pathname)
  document.title = metadata.title
  for (const meta of metadata.metas) {
    const attribute = 'name' in meta ? 'name' : 'property'
    const key = 'name' in meta ? meta.name! : meta.property!
    const element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`) ?? document.createElement('meta')
    element.setAttribute(attribute, key)
    element.content = meta.content
    document.head.appendChild(element)
  }
  if (metadata.canonical) {
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link')
    link.rel = 'canonical'
    link.href = metadata.canonical
    document.head.appendChild(link)
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove()
    document.head.querySelector('meta[property="og:url"]')?.remove()
  }
  document.getElementById('site-structured-data')?.remove()
  if (metadata.structured) {
    const script = document.createElement('script')
    script.id = 'site-structured-data'
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(metadata.structured).replace(/</g, '\\u003c')
    document.head.appendChild(script)
  }
}

export function renderSitemap(): string {
  // Do not invent lastmod timestamps on every build; content dates must reflect actual edits.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitePages.map((page) => `  <url><loc>${escapeHtml(new URL(page.path, websiteUrl).href)}</loc></url>`).join('\n')}\n</urlset>\n`
}

export function renderLlmsIndex(): string {
  return [
    '# DataPad++', '',
    '> A pre-release desktop workbench for SQL, document, key-value, search, graph, time-series and analytical datastores on Windows, macOS and Linux.', '',
    'DataPad++ is not for production workloads. Features and workspace formats may change; unknown defects may cause data loss. Keep independent backups. Capability labels describe availability, not production readiness.', '',
    'The canonical documentation below is available as complete HTML without JavaScript. Native operations, authentication, supported formats and limitations vary by datastore; consult the corresponding guide.', '',
    `Source repository: ${repoUrl}`, '',
    ...['Product and downloads', 'Workflow guides', 'Datastore guides'].flatMap((heading, index) => [
      `## ${heading}`, '',
      ...sitePages.filter((page) => index === 0 ? page.kind === 'website' : index === 1 ? page.kind === 'article' && !page.path.startsWith('/docs/datastores/') : page.path.startsWith('/docs/datastores/'))
        .map((page) => `- [${page.breadcrumbs.at(-1)!.name}](${new URL(page.path, websiteUrl).href}): ${page.description.replace(/\s+/g, ' ')}`), '',
    ]),
  ].join('\n')
}
