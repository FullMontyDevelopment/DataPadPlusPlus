import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clipboard,
  Database,
  ExternalLink,
  FileQuestion,
  Menu,
  Search,
  X,
} from 'lucide-react'
import {
  datastoreDocs,
  datastoreDocsByFamily,
  datastoreGuideLinksByArticleSlug,
  getDatastoreDocBySlug,
  type DatastoreDoc,
} from '../data/datastores'
import {
  docArticles,
  docNavigationGroups,
  getDocBySlug,
  getNextDoc,
  type DocArticle,
  type DocBlock,
  type DocSection,
} from '../data/docs'
import { getScreenshotSlot, type ScreenshotId } from '../data/screenshots'
import { repoUrl } from '../data/product'

type DocsExperienceProps = {
  slug?: string
}

type ArticleModel = {
  title: string
  description: string
  category: string
  readingTime: string
  status?: string
  prerequisites: string[]
  sections: DocSection[]
  related: { href: string; label: string }[]
  previous?: { href: string; label: string }
  next?: { href: string; label: string }
}

const docsIssueUrl = `${repoUrl}/issues/new?labels=documentation&template=docs.yml`

function urlWithSearch(path: string, query: string) {
  return query ? `${path}?q=${encodeURIComponent(query)}` : path
}

function useDocsSearch() {
  const [query, setQueryState] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')

  const setQuery = (value: string) => {
    setQueryState(value)
    const url = new URL(window.location.href)
    if (value.trim()) url.searchParams.set('q', value)
    else url.searchParams.delete('q')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return { query, setQuery }
}

function articleSearchText(article: DocArticle) {
  return [
    article.title,
    article.description,
    article.category,
    ...article.keywords,
    ...article.sections.flatMap((section) => [section.title, section.id]),
  ]
    .join(' ')
    .toLowerCase()
}

function DocsNavigation({ currentSlug, query, onQuery, open, onClose }: {
  currentSlug?: string
  query: string
  onQuery: (value: string) => void
  open: boolean
  onClose: () => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const matchingArticles = normalizedQuery
    ? docArticles.filter((article) => articleSearchText(article).includes(normalizedQuery))
    : []
  const matchingDatastores = normalizedQuery
    ? datastoreDocs.filter((doc) =>
        [doc.title, doc.summary, doc.family, ...(doc.aliases ?? []), ...doc.bestFor]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : []

  return (
    <aside className={`learn-docs-nav${open ? ' is-open' : ''}`} aria-label="Documentation navigation">
      <div className="learn-docs-nav-header">
        <a href={urlWithSearch('/docs', query)} className="learn-docs-home-link">
          <BookOpen size={17} /> Documentation
        </a>
        <button type="button" className="learn-docs-drawer-close" onClick={onClose} aria-label="Close documentation navigation">
          <X size={18} />
        </button>
      </div>
      <label className="learn-docs-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search documentation</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search documentation"
          autoComplete="off"
        />
      </label>
      <div className="learn-docs-nav-scroll">
        {normalizedQuery ? (
          <div className="learn-docs-search-results" aria-live="polite">
            <strong>{matchingArticles.length + matchingDatastores.length} results</strong>
            {matchingArticles.map((article) => (
              <a href={urlWithSearch(`/docs/${article.slug}`, query)} key={article.slug} className={article.slug === currentSlug ? 'active' : ''}>
                <span>{article.title}</span><small>{article.category}</small>
              </a>
            ))}
            {matchingDatastores.map((doc) => (
              <a href={urlWithSearch(`/docs/datastores/${doc.slug}`, query)} key={doc.slug} className={`datastores/${doc.slug}` === currentSlug ? 'active' : ''}>
                <span>{doc.title}</span><small>{doc.family}</small>
              </a>
            ))}
            {!matchingArticles.length && !matchingDatastores.length ? <p>No guide matches this search.</p> : null}
          </div>
        ) : (
          <>
            {docNavigationGroups.map((group) => (
              <section className="learn-docs-nav-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.slugs.map((articleSlug) => {
                  const article = getDocBySlug(articleSlug)
                  return article ? (
                    <a href={`/docs/${article.slug}`} key={article.slug} className={article.slug === currentSlug ? 'active' : ''}>
                      {article.title}
                    </a>
                  ) : null
                })}
              </section>
            ))}
            <section className="learn-docs-nav-group">
              <h2>All 29 datastores</h2>
              <a href="/docs/datastores" className={currentSlug === 'datastores' ? 'active' : ''}>Datastore guide index</a>
              {datastoreDocsByFamily.map((group) => (
                <details key={group.family} open={group.docs.some((doc) => `datastores/${doc.slug}` === currentSlug)}>
                  <summary>{group.family}</summary>
                  {group.docs.map((doc) => (
                    <a href={`/docs/datastores/${doc.slug}`} key={doc.slug} className={`datastores/${doc.slug}` === currentSlug ? 'active' : ''}>
                      {doc.title}
                    </a>
                  ))}
                </details>
              ))}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function ArticleToc({ sections, activeId }: { sections: DocSection[]; activeId: string }) {
  return (
    <nav className="learn-docs-toc" aria-label="In this article">
      <strong>In this article</strong>
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={activeId === section.id ? 'active' : ''}>
          {section.title}
        </a>
      ))}
    </nav>
  )
}

function ScreenshotFigure({ id }: { id: ScreenshotId }) {
  const screenshot = getScreenshotSlot(id)
  return (
    <figure className="learn-docs-figure">
      <a href={screenshot.image} target="_blank" rel="noreferrer" aria-label={`Open full-size image: ${screenshot.title}`}>
        <img src={screenshot.image} alt={screenshot.alt} loading="lazy" />
      </a>
      <figcaption><strong>{screenshot.title}.</strong> {screenshot.caption} <span>Open full size</span></figcaption>
    </figure>
  )
}

function CodeBlock({ language, code, label }: { language: string; code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="learn-docs-code">
      <div><span>{label ?? language}</span><button type="button" aria-label={`Copy ${label ?? language} code`} onClick={copy}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? 'Copied' : 'Copy'}</button></div>
      <pre><code className={`language-${language}`}>{code}</code></pre>
    </div>
  )
}

function BlockRenderer({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{block.text}</p>
    case 'list':
      return <ul>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
    case 'figure':
      return <ScreenshotFigure id={block.screenshot} />
    case 'callout':
      return <aside className={`learn-docs-callout tone-${block.tone}`}><strong>{block.title}</strong><p>{block.body}</p></aside>
    case 'table':
      return (
        <div className="learn-docs-table-wrap"><table><thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div>
      )
    case 'code':
      return <CodeBlock language={block.language} code={block.code} label={block.label} />
    case 'links':
      return <div className="learn-docs-related-grid">{block.links.map((link) => <a key={link.href} href={link.href}><strong>{link.label}</strong><span>{link.description}</span><ChevronRight size={17} /></a>)}</div>
    case 'procedure':
      return (
        <ol className="learn-docs-procedure">
          {block.steps.map((step, index) => (
            <li key={`${step.title}-${index}`}>
              <div className="learn-docs-step-copy"><span>{index + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></div>
              {step.figure ? <ScreenshotFigure id={step.figure} /> : null}
            </li>
          ))}
        </ol>
      )
  }
}

function GeneralArticleModel(article: DocArticle): ArticleModel {
  const next = getNextDoc(article.slug)
  const index = docArticles.findIndex((candidate) => candidate.slug === article.slug)
  const previous = index > 0 ? docArticles[index - 1] : undefined
  const relatedDatastores = (datastoreGuideLinksByArticleSlug[article.slug] ?? [])
    .map((slug) => getDatastoreDocBySlug(slug))
    .filter((doc): doc is DatastoreDoc => Boolean(doc))
  const relatedGuides = (article.relatedGuides ?? [])
    .map((slug) => getDocBySlug(slug))
    .filter((doc): doc is DocArticle => Boolean(doc))
  return {
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: article.readingTime,
    status: article.status,
    prerequisites: article.prerequisites,
    sections: article.sections,
    related: [
      ...relatedGuides.map((doc) => ({ href: `/docs/${doc.slug}`, label: doc.title })),
      ...relatedDatastores.map((doc) => ({ href: `/docs/datastores/${doc.slug}`, label: `${doc.title} guide` })),
    ],
    previous: previous ? { href: `/docs/${previous.slug}`, label: previous.title } : undefined,
    next: next ? { href: `/docs/${next.slug}`, label: next.title } : undefined,
  }
}

function datastoreModel(doc: DatastoreDoc): ArticleModel {
  const index = datastoreDocs.findIndex((candidate) => candidate.slug === doc.slug)
  const previous = datastoreDocs[index - 1]
  const next = datastoreDocs[index + 1]
  const sections: DocSection[] = [
    {
      id: 'quickstart',
      title: 'Connect and run a safe query',
      blocks: [{
        type: 'procedure',
        steps: doc.quickstart.map((body, stepIndex) => ({
          title: ['Create the connection', 'Test and save', 'Open the native explorer', 'Select a scope', 'Run a bounded read', 'Inspect the result', 'Export when needed', 'Open diagnostics or transfers'][stepIndex] ?? `Step ${stepIndex + 1}`,
          body,
          figure: stepIndex === 1 ? doc.screenshots[0]?.id : stepIndex === 4 ? doc.screenshots[1]?.id : undefined,
        })),
      }],
    },
    { id: 'connection-fields', title: 'Connection fields', blocks: [{ type: 'table', columns: ['Field', 'Required', 'Purpose', 'Safe example'], rows: doc.connectionFields.map((field) => [field.name, field.required ? 'Yes' : 'No', field.description, field.example]) }] },
    { id: 'sample-query', title: 'Run the sample query', blocks: [{ type: 'callout', tone: 'important', title: 'Use names from your datastore', body: 'The object names and values below are examples. Replace them with a database, schema, table, collection, index, bucket, metric, key pattern, or graph label that exists in your datastore. Keep the limit until you have reviewed the result.' }, { type: 'code', language: doc.queryLanguage, code: doc.sampleQuery, label: `${doc.title} read-only example` }, { type: 'callout', tone: 'note', title: 'Expected result', body: doc.expectedResult }] },
    { id: 'explore-and-inspect', title: 'Explore and inspect', blocks: [{ type: 'list', items: [...doc.explorer, ...doc.resultViews] }] },
    { id: 'diagnostics-and-administration', title: 'Diagnose, administer, and transfer', blocks: [{ type: 'list', items: [...doc.diagnostics, ...doc.adminFeatures, ...doc.importExport] }, { type: 'figure', screenshot: doc.screenshots[4]?.id ?? 'transfer-center' }] },
    { id: 'capabilities', title: 'Capabilities and availability', blocks: [{ type: 'table', columns: ['Capability', 'Status', 'Notes'], rows: doc.capabilities.map((row) => [row.capability, row.support, row.notes]) }] },
    { id: 'safety-and-limitations', title: 'Safety and limitations', blocks: [{ type: 'callout', tone: 'warning', title: 'Confirm safety before writes', body: `Start with development or staging and a read-only account. Before using an important datastore, confirm the selected target, scope, identity, environment policy, and backup plan. ${doc.safety.join(' ')}` }] },
    { id: 'troubleshooting', title: 'Troubleshooting', blocks: [{ type: 'table', columns: ['Symptom', 'Resolution'], rows: doc.troubleshooting.map((item) => [item.symptom, item.resolution]) }] },
  ]
  return {
    title: doc.title,
    description: doc.summary,
    category: doc.family,
    readingTime: '12 min',
    status: doc.maturity,
    prerequisites: doc.prerequisites,
    sections,
    related: [
      { href: '/docs/connections', label: 'Create and organize connections' },
      { href: '/docs/native-datastore-transfers', label: 'Native datastore transfers' },
      { href: '/docs/safety-model', label: 'Safety model' },
    ],
    previous: previous ? { href: `/docs/datastores/${previous.slug}`, label: previous.title } : { href: '/docs/datastores', label: 'Datastore guide index' },
    next: next ? { href: `/docs/datastores/${next.slug}`, label: next.title } : undefined,
  }
}

function ArticlePage({ model, query, onOpenNavigation }: { model: ArticleModel; query: string; onOpenNavigation: () => void }) {
  const [activeId, setActiveId] = useState(model.sections[0]?.id ?? '')

  useEffect(() => {
    setActiveId(model.sections[0]?.id ?? '')
    const headings = model.sections.map((section) => document.getElementById(section.id)).filter((item): item is HTMLElement => Boolean(item))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible?.target.id) setActiveId(visible.target.id)
    }, { rootMargin: '-18% 0px -65% 0px', threshold: [0, 1] })
    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [model])

  return (
    <>
      <button type="button" className="learn-docs-mobile-menu" onClick={onOpenNavigation}><Menu size={17} /> Browse documentation</button>
      <article className="learn-docs-article">
        <nav className="learn-docs-breadcrumb" aria-label="Breadcrumb">
          <a href={urlWithSearch('/docs', query)}>Docs</a><ChevronRight size={14} /><span>{model.category}</span><ChevronRight size={14} /><span aria-current="page">{model.title}</span>
        </nav>
        <header className="learn-docs-article-header">
          <p className="learn-docs-eyebrow">{model.category}</p>
          <h1>{model.title}</h1>
          <p className="learn-docs-lede">{model.description}</p>
          <div className="learn-docs-meta"><span>{model.status ?? 'Live'}</span><span>{model.readingTime}</span><span>Desktop</span></div>
        </header>
        <div className="learn-docs-tablet-toc"><ArticleToc sections={model.sections} activeId={activeId} /></div>
        <section className="learn-docs-prerequisites" aria-labelledby="prerequisites-heading">
          <h2 id="prerequisites-heading">Prerequisites</h2>
          <ul>{model.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        {model.sections.map((section) => (
          <section className="learn-docs-section" id={section.id} key={section.id}>
            <h2><a href={`#${section.id}`} aria-label={`Link to ${section.title}`}>{section.title}</a></h2>
            {section.blocks.map((block, index) => <BlockRenderer block={block} key={`${block.type}-${index}`} />)}
          </section>
        ))}
        {model.related.length ? (
          <section className="learn-docs-section" id="related-content"><h2><a href="#related-content">Related content</a></h2><div className="learn-docs-related-grid">{model.related.map((link) => <a href={link.href} key={`${link.href}-${link.label}`}><strong>{link.label}</strong><span>Continue with this DataPad++ guide.</span><ChevronRight size={17} /></a>)}</div></section>
        ) : null}
        <div className="learn-docs-pager">
          {model.previous ? <a href={model.previous.href}><ArrowLeft size={17} /><span><small>Previous</small>{model.previous.label}</span></a> : <span />}
          {model.next ? <a href={model.next.href}><span><small>Next</small>{model.next.label}</span><ArrowRight size={17} /></a> : null}
        </div>
        <footer className="learn-docs-feedback"><FileQuestion size={18} /><span>Was something unclear or out of date?</span><a href={`${docsIssueUrl}&title=${encodeURIComponent(`Docs: ${model.title}`)}`} target="_blank" rel="noreferrer">Open a documentation issue <ExternalLink size={14} /></a></footer>
      </article>
      <aside className="learn-docs-toc-column"><ArticleToc sections={model.sections} activeId={activeId} /></aside>
    </>
  )
}

function DocsIndex({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  return (
    <>
      <button type="button" className="learn-docs-mobile-menu" onClick={onOpenNavigation}><Menu size={17} /> Browse documentation</button>
      <main className="learn-docs-index-page">
        <div className="learn-docs-index-hero"><p className="learn-docs-eyebrow">DataPad++ documentation</p><h1>Work safely across every datastore</h1><p>Step-by-step guides for the workbench, all seven plugins, common tasks, diagnostics, transfers, and all 29 declared datastore engines.</p><div><a href="/docs/first-query">Run your first query <ArrowRight size={16} /></a><a href="/docs/plugins">Explore plugins</a></div></div>
        <aside className="learn-docs-callout tone-warning"><strong>Pre-release software</strong><p>Use disposable, local, emulated, or read-only systems first. Keep independent backups and review every target before writes, administration, restore, or transfer execution.</p></aside>
        <div className="learn-docs-index-groups">
          {docNavigationGroups.map((group) => <section key={group.label}><h2>{group.label}</h2>{group.slugs.map((slug) => { const article = getDocBySlug(slug); return article ? <a key={slug} href={`/docs/${slug}`}><span><strong>{article.title}</strong><small>{article.description}</small></span><ChevronRight size={17} /></a> : null })}</section>)}
          <section><h2>All 29 datastores</h2><a href="/docs/datastores"><span><strong>Datastore guide index</strong><small>Connection fields, native workflows, sample reads, capabilities, diagnostics, transfers, limitations, and troubleshooting.</small></span><ChevronRight size={17} /></a></section>
        </div>
      </main>
      <aside className="learn-docs-toc-column learn-docs-index-aside"><strong>Popular tasks</strong><a href="/docs/connections">Create a connection</a><a href="/docs/plugins">Enable a plugin</a><a href="/docs/query-history-explain">Explain a query</a><a href="/docs/transfers-center">Monitor a transfer</a><a href="/docs/appearance-shortcuts-logs">Collect logs</a></aside>
    </>
  )
}

function DatastoreIndex({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  return (
    <>
      <button type="button" className="learn-docs-mobile-menu" onClick={onOpenNavigation}><Menu size={17} /> Browse documentation</button>
      <main className="learn-docs-index-page">
        <nav className="learn-docs-breadcrumb" aria-label="Breadcrumb"><a href="/docs">Docs</a><ChevronRight size={14} /><span aria-current="page">Datastores</span></nav>
        <div className="learn-docs-index-hero compact"><p className="learn-docs-eyebrow">29 engine guides</p><h1>Datastore guides</h1><p>Every guide uses the same safe path—connect, explore, scope, read, inspect, export, diagnose, and transfer—then names the controls and limits that differ for that engine.</p></div>
        <div className="learn-docs-datastore-groups">{datastoreDocsByFamily.map((group) => <section key={group.family}><header><h2>{group.family}</h2><span>{group.docs.length} engines</span></header><div>{group.docs.map((doc) => <a href={`/docs/datastores/${doc.slug}`} key={doc.slug}><span><strong>{doc.title}</strong><small>{doc.summary}</small><em>{doc.maturity}</em></span><ChevronRight size={18} /></a>)}</div></section>)}</div>
      </main>
      <aside className="learn-docs-toc-column learn-docs-index-aside"><strong>Guide pattern</strong><span>Prerequisites</span><span>Connect and test</span><span>Explore and scope</span><span>Run a safe read</span><span>Inspect and export</span><span>Diagnose and transfer</span><span>Limits and troubleshooting</span></aside>
    </>
  )
}

export function DocsExperience({ slug }: DocsExperienceProps) {
  const { query, setQuery } = useDocsSearch()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const content = useMemo(() => {
    if (!slug) return <DocsIndex onOpenNavigation={() => setNavigationOpen(true)} />
    if (slug === 'datastores') return <DatastoreIndex onOpenNavigation={() => setNavigationOpen(true)} />
    if (slug.startsWith('datastores/')) {
      const doc = getDatastoreDocBySlug(slug.slice('datastores/'.length))
      return doc ? <ArticlePage model={datastoreModel(doc)} query={query} onOpenNavigation={() => setNavigationOpen(true)} /> : null
    }
    const article = getDocBySlug(slug)
    return article ? <ArticlePage model={GeneralArticleModel(article)} query={query} onOpenNavigation={() => setNavigationOpen(true)} /> : null
  }, [query, slug])

  useEffect(() => setNavigationOpen(false), [slug])

  return (
    <main className="learn-docs-shell">
      <div className="learn-docs-layout">
        <DocsNavigation currentSlug={slug} query={query} onQuery={setQuery} open={navigationOpen} onClose={() => setNavigationOpen(false)} />
        {content ?? (
          <section className="learn-docs-not-found"><FileQuestion size={32} /><h1>Documentation page not found</h1><p>The requested guide does not exist or has moved.</p><a href="/docs">Browse documentation</a></section>
        )}
      </div>
      {navigationOpen ? <button type="button" className="learn-docs-drawer-scrim" onClick={() => setNavigationOpen(false)} aria-label="Close documentation navigation" /> : null}
    </main>
  )
}
