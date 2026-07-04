import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  HardDriveDownload,
  Library,
  LockKeyhole,
  MonitorDown,
  Network,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import brandLogo from '../../desktop/public/favicon.svg'
import heroMark from '../../desktop/src/assets/hero.png'
import {
  datastoreDocs,
  datastoreDocsByFamily,
  datastoreGuideLinksByArticleSlug,
  getDatastoreDocBySlug,
  type DatastoreDoc,
  type DatastoreScreenshot,
} from './data/datastores'
import { docArticles, docCategories, getDocBySlug, getNextDoc } from './data/docs'
import { coreFeatures, datastoreGroups, launchWorkflow, releasesUrl, repoUrl } from './data/product'
import { getScreenshotSlot, type ScreenshotId } from './data/screenshots'
import {
  classifyReleaseDownloads,
  formatBytes,
  getDownloadsForPlatform,
  getRecommendedDownload,
  type ClassifiedDownload,
} from './lib/downloads'
import { detectPlatform, platformLabel, type Platform } from './lib/platform'
import { fetchReleases, type GitHubRelease } from './lib/releases'

type Route =
  | { name: 'home' }
  | { name: 'features' }
  | { name: 'safety' }
  | { name: 'coverage' }
  | { name: 'downloads' }
  | { name: 'docs'; slug?: string }

const navItems = [
  { href: '/', label: 'Product' },
  { href: '/features', label: 'Features' },
  { href: '/coverage', label: 'Datastores' },
  { href: '/docs', label: 'Docs' },
  { href: '/download', label: 'Download' },
]

const platformIcons: Record<Platform, typeof MonitorDown> = {
  windows: MonitorDown,
  macos: HardDriveDownload,
  linux: TerminalSquare,
  unknown: FileArchive,
}

function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === '/features') return { name: 'features' }
  if (path === '/safety') return { name: 'safety' }
  if (path === '/coverage') return { name: 'coverage' }
  if (path === '/download' || path === '/downloads') return { name: 'downloads' }
  if (path === '/docs') return { name: 'docs' }
  if (path.startsWith('/docs/')) return { name: 'docs', slug: path.slice('/docs/'.length) }
  return { name: 'home' }
}

function useRoute() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname))

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (href: string) => {
    window.history.pushState({}, '', href)
    setRoute(routeFromPath(window.location.pathname))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return { route, navigate }
}

type AppLinkProps = {
  href: string
  children: React.ReactNode
  className?: string
  ariaLabel?: string
  external?: boolean
}

function AppLink({ href, children, className, ariaLabel, external }: AppLinkProps) {
  if (external) {
    return (
      <a className={className} href={href} aria-label={ariaLabel} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }

  return (
    <a className={className} href={href} aria-label={ariaLabel}>
      {children}
    </a>
  )
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand-lockup" href="/" aria-label="DataPad++ home">
        <img src={brandLogo} alt="" />
        <span>DataPad++</span>
      </a>
      <nav className="desktop-nav" aria-label="Primary">
        {navItems.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
        <AppLink href={repoUrl} external className="nav-github">
          GitHub <ExternalLink size={15} />
        </AppLink>
      </nav>
      <a className="header-download" href="/download">
        <Download size={17} />
        Download
      </a>
    </header>
  )
}

function ScreenshotFrame({
  title,
  caption,
  image,
  compact = false,
}: {
  title: string
  caption: string
  image?: string
  compact?: boolean
}) {
  return (
    <figure className={compact ? 'screenshot-frame compact' : 'screenshot-frame'}>
      {image ? (
        <img src={image} alt={title} />
      ) : (
        <div className="screenshot-placeholder">
          <div className="placeholder-topbar">
            <span />
            <span />
            <span />
          </div>
          <div className="placeholder-body">
            <div className="placeholder-rail">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="placeholder-main">
              <strong>{title}</strong>
              <p>{caption}</p>
              <div className="placeholder-grid">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function ScreenshotPlaceholder({ id, compact = false }: { id: ScreenshotId; compact?: boolean }) {
  const slot = getScreenshotSlot(id)
  return <ScreenshotFrame title={slot.title} caption={slot.caption} image={slot.image} compact={compact} />
}

function DatastoreScreenshotPlaceholder({
  screenshot,
  compact = false,
}: {
  screenshot: DatastoreScreenshot
  compact?: boolean
}) {
  return <ScreenshotFrame title={screenshot.title} caption={screenshot.caption} compact={compact} />
}

function WorkbenchMockup() {
  return (
    <div className="workbench-mockup" aria-label="DataPad++ workbench preview">
      <div className="mock-titlebar">
        <span className="traffic red" />
        <span className="traffic amber" />
        <span className="traffic green" />
        <span>DataPad++</span>
      </div>
      <div className="mock-shell">
        <aside className="mock-sidebar">
          <strong>Connections</strong>
          {['PostgreSQL Local', 'MongoDB Atlas', 'Redis Cache', 'SQL Server'].map((item, index) => (
            <span key={item} className={index === 0 ? 'active' : ''}>
              <Database size={13} /> {item}
            </span>
          ))}
          <strong>Environments</strong>
          {['Development', 'Staging', 'Production'].map((item) => (
            <span key={item}>
              <ShieldCheck size={13} /> {item}
            </span>
          ))}
        </aside>
        <main className="mock-editor">
          <div className="mock-toolbar">
            <span>Query 1</span>
            <button type="button">Run</button>
            <button type="button">Explain</button>
          </div>
          <pre>{`-- Your query here\nSELECT * FROM users\nORDER BY created_at DESC\nLIMIT 100;`}</pre>
          <div className="mock-results">
            <strong>Results</strong>
            {['Jane Cooper', 'Darrell Steward', 'Esther Howard', 'Jenny Wilson'].map((name, index) => (
              <span key={name}>
                <b>{index + 1}</b>
                {name}
                <em>ready</em>
              </span>
            ))}
          </div>
        </main>
        <aside className="mock-inspector">
          <span className="selected">Explorer</span>
          <span>public</span>
          <span>Tables</span>
          <span className="active">users</span>
          <span>orders</span>
          <span>indexes</span>
        </aside>
      </div>
    </div>
  )
}

function ReleaseSummary({ release, platform }: { release?: GitHubRelease; platform: Platform }) {
  const recommended = getRecommendedDownload(release, platform)
  return (
    <section className="release-summary" aria-label="Latest release">
      <div>
        <span>Latest release</span>
        <strong>{release?.name || release?.tag_name || 'Release data loading'}</strong>
        <small>
          {release?.published_at
            ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(release.published_at))
            : 'From GitHub Releases'}
        </small>
      </div>
      <div>
        <span>Recommended for {platformLabel(platform)}</span>
        <strong>{recommended?.kind ?? 'Available artifacts'}</strong>
        <small>{recommended ? recommended.asset.name : 'See all release downloads'}</small>
      </div>
      <a href="/download">
        Open downloads <ArrowRight size={16} />
      </a>
    </section>
  )
}

function HomePage({ releases, platform }: { releases: GitHubRelease[]; platform: Platform }) {
  const latestRelease = releases[0]

  return (
    <>
      <section className="hero-section">
        <div className="hero-copy">
          <h1>DataPad++</h1>
          <p className="tagline">
            <span>All Data.</span> One Pad.
          </p>
          <p className="hero-body">
            A desktop datastore workbench for people who move between SQL, MongoDB, Redis, search, cloud,
            analytics, local files, and production guardrails every day.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="/download">
              <Download size={19} />
              Download
            </a>
            <a className="secondary-action" href="/docs">
              <BookOpen size={19} />
              Read the docs
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <img className="hero-mark" src={heroMark} alt="" />
          <WorkbenchMockup />
        </div>
      </section>
      <ReleaseSummary release={latestRelease} platform={platform} />
      <section className="section split-section">
        <div>
          <h2>Built for real data work</h2>
          <p>
            DataPad++ is not trying to flatten every datastore into the same generic table. It gives each
            family its own surface while keeping saved work, environments, safety, and results in one place.
          </p>
        </div>
        <div className="feature-list">
          {coreFeatures.map((feature) => (
            <a href="/features" key={feature.title} className="feature-row">
              <CheckCircle2 size={18} />
              <span>
                <strong>{feature.title}</strong>
                {feature.description}
              </span>
            </a>
          ))}
        </div>
      </section>
      <section className="section docs-preview">
        <div className="section-heading">
          <h2>Step-by-step documentation</h2>
          <p>Start with installation, then move through connections, environments, querying, results, local servers, workspace search, safety, and datastore-specific guides.</p>
        </div>
        <div className="doc-card-grid">
          {docArticles.slice(0, 6).map((article) => (
            <a href={`/docs/${article.slug}`} className="doc-card" key={article.slug}>
              <span>{article.category}</span>
              <strong>{article.title}</strong>
              <p>{article.description}</p>
              <ChevronRight size={18} />
            </a>
          ))}
        </div>
      </section>
      <section className="section media-strip">
        <ScreenshotPlaceholder id="connection-wizard" compact />
        <ScreenshotPlaceholder id="sql-query-results" compact />
        <ScreenshotPlaceholder id="redis-browser" compact />
      </section>
    </>
  )
}

function FeaturesPage() {
  return (
    <main className="page-shell">
      <PageTitle
        icon={Sparkles}
        title="Features"
        body="A datastore workbench shaped around connection context, native object exploration, careful execution, and reusable work."
      />
      <div className="feature-deep-list">
        {coreFeatures.map((feature) => (
          <section className="feature-deep" key={feature.title}>
            <div>
              <h2>{feature.title}</h2>
              <p>{feature.description}</p>
              <a href="/docs">
                Learn the workflow <ArrowRight size={16} />
              </a>
            </div>
            <ScreenshotPlaceholder id={feature.screenshot} compact />
          </section>
        ))}
      </div>
      <section className="section workflow-section">
        <h2>Everyday workflow</h2>
        <ol>
          {launchWorkflow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function SafetyPage() {
  return (
    <main className="page-shell">
      <PageTitle
        icon={LockKeyhole}
        title="Safety And Guardrails"
        body="DataPad++ is designed around a simple rule: make dangerous work visible and keep secrets out of plain text."
      />
      <section className="safety-layout">
        <div className="safety-principles">
          {[
            ['Prove the target', 'Live edits need concrete identity such as primary keys, document ids, key names, or complete cloud keys.'],
            ['Respect context', 'Read-only profiles and production environments shape which actions are available.'],
            ['Preview risky work', 'Admin, destructive, import/export, backup, and restore actions should show a reviewable plan before execution.'],
            ['Protect secrets', 'Workspace exports, optional secret inclusion, and backups remain encrypted and explicit.'],
          ].map(([title, body]) => (
            <div className="principle" key={title}>
              <ShieldCheck size={22} />
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <ScreenshotPlaceholder id="safety-preview" />
      </section>
    </main>
  )
}

function CoveragePage() {
  const nativeComplete = datastoreDocs.filter((doc) => doc.maturity.toLowerCase().includes('native-complete')).length
  const contractComplete = datastoreDocs.length
  const contractOnly = contractComplete - nativeComplete

  return (
    <main className="page-shell">
      <PageTitle
        icon={Network}
        title="Datastore Coverage"
        body="DataPad++ supports native-feeling workflows across SQL, document, cache, search, cloud, local, analytics, metrics, and graph families."
      />
      <section className="coverage-summary" aria-label="Datastore maturity summary">
        <div>
          <strong>{contractComplete}</strong>
          <span>documented engines</span>
          <p>Every declared datastore has connection, explorer, query, result, operation, diagnostic, import/export, and safety docs.</p>
        </div>
        <div>
          <strong>{nativeComplete}</strong>
          <span>native-complete scoped claims</span>
          <p>These engines have the strongest live, fixture, or adapter-backed evidence for their release scope.</p>
        </div>
        <div>
          <strong>{contractOnly}</strong>
          <span>contract-complete preview paths</span>
          <p>These surfaces are documented and guarded, with live cloud, driver, or admin validation still treated as residual risk.</p>
        </div>
      </section>
      <section className="coverage-grid">
        {datastoreGroups.map((group) => (
          <div className="coverage-group" key={group.family}>
            <h2>{group.family}</h2>
            <div>
              {group.engines.map((engine) => (
                <span key={engine}>{engine}</span>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="section split-section">
        <div>
          <h2>Scoped claims, clear boundaries</h2>
          <p>
            Some engines are live-complete for scoped workflows while others remain preview-first, fixture-backed, or contract-complete. The site should make that maturity visible instead of overstating production readiness.
          </p>
        </div>
        <a className="text-link-panel" href="/docs/datastores">
          Browse datastore-specific docs <ArrowRight size={18} />
        </a>
      </section>
    </main>
  )
}

function DownloadCard({
  download,
  featured = false,
}: {
  download: ClassifiedDownload
  featured?: boolean
}) {
  const Icon = platformIcons[download.platform]
  return (
    <a className={featured ? 'download-card featured' : 'download-card'} href={download.asset.browser_download_url}>
      <Icon size={26} />
      <span>{featured ? 'Recommended download' : platformLabel(download.platform)}</span>
      <strong>{download.kind}</strong>
      <small>{download.asset.name}</small>
      <em>{formatBytes(download.asset.size)}</em>
    </a>
  )
}

function DownloadsPage({
  releases,
  releasesStatus,
  platform,
}: {
  releases: GitHubRelease[]
  releasesStatus: 'loading' | 'ready' | 'error'
  platform: Platform
}) {
  const latestRelease = releases[0]
  const recommended = getRecommendedDownload(latestRelease, platform)
  const platformDownloads = getDownloadsForPlatform(latestRelease, platform)
  const allDownloads = latestRelease ? classifyReleaseDownloads(latestRelease) : []
  const otherDownloads = allDownloads.filter((download) => download.asset.id !== recommended?.asset.id)

  return (
    <main className="page-shell">
      <PageTitle
        icon={Download}
        title="Download DataPad++"
        body="The site reads published GitHub Releases and recommends the best desktop artifact for your platform while keeping every other platform visible."
      />
      <section className="download-hero">
        <div>
          <span>Detected platform</span>
          <strong>{platformLabel(platform)}</strong>
          <p>
            Latest version:{' '}
            {latestRelease ? (
              <a href={latestRelease.html_url} target="_blank" rel="noreferrer">
                {latestRelease.name || latestRelease.tag_name}
              </a>
            ) : (
              'loading from GitHub'
            )}
          </p>
          {latestRelease?.prerelease ? <em>Pre-release build</em> : null}
        </div>
        {recommended ? (
          <DownloadCard download={recommended} featured />
        ) : (
          <div className="download-empty">
            <Server size={28} />
            <strong>{releasesStatus === 'error' ? 'Release data unavailable' : 'No installer assets found yet'}</strong>
            <p>Open GitHub Releases for the latest manually published assets.</p>
            <a href={releasesUrl} target="_blank" rel="noreferrer">
              GitHub Releases <ExternalLink size={15} />
            </a>
          </div>
        )}
      </section>
      {platformDownloads.length > 1 ? (
        <section className="section">
          <h2>More for {platformLabel(platform)}</h2>
          <div className="download-grid">
            {platformDownloads
              .filter((download) => download.asset.id !== recommended?.asset.id)
              .map((download) => (
                <DownloadCard key={download.asset.id} download={download} />
              ))}
          </div>
        </section>
      ) : null}
      <section className="section">
        <h2>Other platforms</h2>
        {otherDownloads.length ? (
          <div className="download-grid">
            {otherDownloads.map((download) => (
              <DownloadCard key={download.asset.id} download={download} />
            ))}
          </div>
        ) : (
          <p className="muted-line">No additional installer assets were found in the latest release.</p>
        )}
      </section>
      <section className="section releases-list">
        <h2>Recent versions</h2>
        {releases.length ? (
          releases.map((release) => (
            <a href={release.html_url} key={release.id} target="_blank" rel="noreferrer">
              <span>{release.name || release.tag_name}</span>
              <small>
                {release.published_at
                  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(release.published_at))
                  : 'Unpublished date'}
                {release.prerelease ? ' · pre-release' : ''}
              </small>
              <ExternalLink size={16} />
            </a>
          ))
        ) : (
          <p className="muted-line">
            {releasesStatus === 'error'
              ? 'Could not load GitHub Releases right now.'
              : 'Loading recent releases from GitHub.'}
          </p>
        )}
      </section>
    </main>
  )
}

function DatastoreDocsIndex() {
  return (
    <main className="docs-shell datastore-docs-shell">
      <PageTitle
        icon={Database}
        title="Datastore-Specific Docs"
        body="Connection fields, native object models, query modes, result views, diagnostics, admin previews, import/export paths, and safety boundaries for each supported engine."
      />
      <section className="datastore-directory" aria-label="Datastore documentation">
        {datastoreDocsByFamily.map((group) => (
          <div className="datastore-family-group" key={group.family}>
            <div className="datastore-family-heading">
              <h2>{group.family}</h2>
              <span>{group.docs.length} engines</span>
            </div>
            <div className="datastore-card-grid">
              {group.docs.map((doc) => (
                <a className="datastore-card" href={`/docs/datastores/${doc.slug}`} key={doc.slug}>
                  <span>{doc.maturity}</span>
                  <strong>{doc.title}</strong>
                  <p>{doc.summary}</p>
                  <small>{doc.bestFor.join(' / ')}</small>
                  <ChevronRight size={18} />
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  )
}

function DatastoreDocSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="datastore-doc-section">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

function DatastoreDetailPage({ doc }: { doc: DatastoreDoc }) {
  const sections = [
    ['Connections And Authentication', doc.connections],
    ['Explorer And Object Model', doc.explorer],
    ['Query Modes', doc.queryModes],
    ['Result Views And Editing', doc.resultViews],
    ['Admin And Guarded Operations', doc.adminFeatures],
    ['Diagnostics And Performance', doc.diagnostics],
    ['Import, Export, And Backups', doc.importExport],
    ['Safety Boundaries And Maturity', doc.safety],
  ] as const
  const relatedArticles = docArticles.filter((article) =>
    datastoreGuideLinksByArticleSlug[article.slug]?.includes(doc.slug),
  )

  return (
    <main className="doc-article-layout datastore-detail-layout">
      <aside className="doc-sidebar">
        <a className="all-docs-link" href="/docs">
          <BookOpen size={16} />
          All docs
        </a>
        <a className="all-docs-link" href="/docs/datastores">
          <Database size={16} />
          Datastores
        </a>
        {datastoreDocsByFamily.map((group) => (
          <div key={group.family}>
            <strong>{group.family}</strong>
            {group.docs.map((item) => (
              <a key={item.slug} className={item.slug === doc.slug ? 'active' : ''} href={`/docs/datastores/${item.slug}`}>
                {item.title}
              </a>
            ))}
          </div>
        ))}
      </aside>
      <article className="doc-article datastore-article">
        <span className="doc-meta">
          {doc.family} - {doc.maturity}
        </span>
        <h1>{doc.title}</h1>
        <p className="doc-description">{doc.summary}</p>
        <div className="datastore-best-for" aria-label="Best fit">
          {doc.bestFor.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="article-screenshots datastore-screenshots">
          {doc.screenshots.map((screenshot) => (
            <DatastoreScreenshotPlaceholder screenshot={screenshot} compact key={screenshot.title} />
          ))}
        </div>
        <div className="datastore-doc-sections">
          {sections.map(([title, items]) => (
            <DatastoreDocSection title={title} items={items} key={title} />
          ))}
        </div>
        {relatedArticles.length ? (
          <section className="related-datastores">
            <h2>Related launch docs</h2>
            <div>
              {relatedArticles.map((article) => (
                <a href={`/docs/${article.slug}`} key={article.slug}>
                  {article.title} <ArrowRight size={16} />
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </main>
  )
}

function DocsPage({ slug }: { slug?: string }) {
  if (slug === 'datastores') {
    return <DatastoreDocsIndex />
  }

  if (slug?.startsWith('datastores/')) {
    const datastoreDoc = getDatastoreDocBySlug(slug.slice('datastores/'.length))

    if (!datastoreDoc) {
      return (
        <main className="page-shell">
          <PageTitle icon={Database} title="Datastore docs not found" body="The requested datastore article is not available yet." />
          <a className="primary-action inline-action" href="/docs/datastores">
            Browse datastore docs
          </a>
        </main>
      )
    }

    return <DatastoreDetailPage doc={datastoreDoc} />
  }

  const article = slug ? getDocBySlug(slug) : undefined
  if (slug && !article) {
    return (
      <main className="page-shell">
        <PageTitle icon={BookOpen} title="Docs page not found" body="The requested article is not available yet." />
        <a className="primary-action inline-action" href="/docs">
          Browse docs
        </a>
      </main>
    )
  }

  if (!article) {
    return (
      <main className="docs-shell">
        <PageTitle
          icon={BookOpen}
          title="Documentation And Wiki"
          body="Full launch docs for installation, first use, core workflows, safety, settings, and datastore-family guides."
        />
        <section className="docs-index">
          <div className="docs-category featured-docs-category">
            <h2>Datastore specifics</h2>
            <a href="/docs/datastores">
              <span>
                <strong>Datastore-Specific Docs</strong>
                Connections, admin features, result views, diagnostics, import/export, and safety boundaries for every declared engine.
              </span>
              <small>{datastoreDocs.length} engines</small>
            </a>
          </div>
          {docCategories.map((category) => (
            <div className="docs-category" key={category}>
              <h2>{category}</h2>
              {docArticles
                .filter((item) => item.category === category)
                .map((item) => (
                  <a href={`/docs/${item.slug}`} key={item.slug}>
                    <span>
                      <strong>{item.title}</strong>
                      {item.description}
                    </span>
                    <small>{item.readingTime}</small>
                  </a>
                ))}
            </div>
          ))}
        </section>
      </main>
    )
  }

  const nextDoc = getNextDoc(article.slug)
  const relatedDatastores = (datastoreGuideLinksByArticleSlug[article.slug] ?? [])
    .map((datastoreSlug) => getDatastoreDocBySlug(datastoreSlug))
    .filter((item): item is DatastoreDoc => Boolean(item))

  return (
    <main className="doc-article-layout">
      <aside className="doc-sidebar">
        <a className="all-docs-link" href="/docs">
          <BookOpen size={16} />
          All docs
        </a>
        <a className="all-docs-link" href="/docs/datastores">
          <Database size={16} />
          Datastores
        </a>
        {docCategories.map((category) => (
          <div key={category}>
            <strong>{category}</strong>
            {docArticles
              .filter((item) => item.category === category)
              .map((item) => (
                <a key={item.slug} className={item.slug === article.slug ? 'active' : ''} href={`/docs/${item.slug}`}>
                  {item.title}
                </a>
              ))}
          </div>
        ))}
      </aside>
      <article className="doc-article">
        <span className="doc-meta">
          {article.category} · {article.readingTime}
        </span>
        <h1>{article.title}</h1>
        <p className="doc-description">{article.description}</p>
        <div className="article-screenshots">
          {article.screenshots.map((screenshot) => (
            <ScreenshotPlaceholder id={screenshot} compact key={screenshot} />
          ))}
        </div>
        <section className="step-list">
          {article.steps.map((step, index) => (
            <div className="step-item" key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </div>
            </div>
          ))}
        </section>
        {article.notes?.length ? (
          <section className="doc-notes">
            <h2>Notes</h2>
            {article.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>
        ) : null}
        {relatedDatastores.length ? (
          <section className="related-datastores">
            <h2>Datastore details</h2>
            <div>
              {relatedDatastores.map((datastoreDoc) => (
                <a href={`/docs/datastores/${datastoreDoc.slug}`} key={datastoreDoc.slug}>
                  {datastoreDoc.title} <ArrowRight size={16} />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {nextDoc ? (
          <a className="next-doc" href={`/docs/${nextDoc.slug}`}>
            Next: {nextDoc.title} <ArrowRight size={18} />
          </a>
        ) : null}
      </article>
    </main>
  )
}

function PageTitle({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Database
  title: string
  body: string
}) {
  return (
    <section className="page-title">
      <Icon size={34} />
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  )
}

export function App() {
  const { route } = useRoute()
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [releases, setReleases] = useState<GitHubRelease[]>([])
  const [releasesStatus, setReleasesStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetchReleases(controller.signal)
      .then((releaseData) => {
        setReleases(releaseData)
        setReleasesStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setReleasesStatus('error')
      })

    return () => controller.abort()
  }, [])

  const page = useMemo(() => {
    switch (route.name) {
      case 'features':
        return <FeaturesPage />
      case 'safety':
        return <SafetyPage />
      case 'coverage':
        return <CoveragePage />
      case 'downloads':
        return <DownloadsPage releases={releases} releasesStatus={releasesStatus} platform={platform} />
      case 'docs':
        return <DocsPage slug={route.slug} />
      case 'home':
      default:
        return <HomePage releases={releases} platform={platform} />
    }
  }, [platform, releases, releasesStatus, route])

  return (
    <div className="site-app">
      <Header />
      {page}
      <footer className="site-footer">
        <div>
          <strong>DataPad++</strong>
          <span>All Data. One Pad.</span>
        </div>
        <nav aria-label="Footer">
          <a href="/features">Features</a>
          <a href="/safety">Safety</a>
          <a href="/coverage">Datastores</a>
          <a href="/docs">Docs</a>
          <a href="/download">Download</a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            GitHub <ExternalLink size={15} />
          </a>
        </nav>
      </footer>
    </div>
  )
}
