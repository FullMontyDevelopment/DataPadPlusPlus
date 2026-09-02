import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
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
import heroMark from '../../desktop/src/assets/hero.png'
import { datastoreDocs, getDatastoreDocByName } from './data/datastores'
import { docArticles } from './data/docs'
import {
  coreFeatures,
  datastoreGroups,
  launchWorkflow,
  releasesUrl,
  repoUrl,
  websiteUrl,
} from './data/product'
import { getScreenshotSlot, type ScreenshotId } from './data/screenshots'
import { DocsExperience } from './docs/DocsExperience'
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
        <img src="/favicon.png" alt="" />
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

function PreReleaseNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={compact ? 'pre-release-notice compact' : 'pre-release-notice'} aria-label="Pre-release safety notice">
      <AlertTriangle size={compact ? 17 : 22} aria-hidden="true" />
      <div>
        <strong>Pre-release software — not for production workloads</strong>
        {compact ? null : (
          <p>
            Features, workspace formats, and behavior may change. Unknown defects may cause incorrect operations,
            service disruption, or data loss. Start with disposable, local, or read-only systems and keep independent backups.
          </p>
        )}
      </div>
      <a href="/safety">Read the safety boundary</a>
    </aside>
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
  image: string
  compact?: boolean
}) {
  return (
    <figure className={compact ? 'screenshot-frame compact' : 'screenshot-frame'}>
      <img src={image} alt={`${title}. ${caption}`} />
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function ScreenshotAsset({ id, compact = false }: { id: ScreenshotId; compact?: boolean }) {
  const slot = getScreenshotSlot(id)
  return <ScreenshotFrame title={slot.title} caption={slot.caption} image={slot.image} compact={compact} />
}

function HeroProductVisual() {
  const screenshot = getScreenshotSlot('sql-query-results')

  return (
    <figure className="hero-product-visual">
      <div className="hero-product-window">
        <div className="hero-product-chrome" aria-hidden="true">
          <span className="hero-window-dot is-red" />
          <span className="hero-window-dot is-amber" />
          <span className="hero-window-dot is-green" />
          <strong>DataPad++</strong>
          <span className="hero-capture-proof">
            <i /> Actual desktop capture
          </span>
        </div>
        <div className="hero-product-image">
          <img
            src={screenshot.image}
            alt="DataPad++ desktop application showing a PostgreSQL query, Local Demo environment, result grid, connections, and status controls."
            fetchPriority="high"
          />
        </div>
      </div>
      <figcaption>
        <span>Example workspace</span>
        PostgreSQL query and bounded results in the current desktop app.
      </figcaption>
    </figure>
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
          <span className="hero-kicker">Pre-release desktop workbench</span>
          <h1>DataPad++</h1>
          <p className="tagline">
            <span>All Data.</span> One Pad.
          </p>
          <p className="hero-body">
            Replace a stack of disconnected database IDEs and shallow editor extensions with one workspace that
            keeps your datastore, environment, database/schema, tabs, and safety context visible.
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
          <HeroProductVisual />
        </div>
      </section>
      <ReleaseSummary release={latestRelease} platform={platform} />
      <section className="section split-section">
        <div>
          <h2>One application, without one generic experience</h2>
          <p>
            Keep connections, environments, queries, results, saved work, diagnostics, and guarded operations
            together while each datastore retains the tools and types that make it useful.
          </p>
        </div>
        <div className="feature-list">
          {coreFeatures.map((feature) => (
            <a href="/features" key={feature.title} className="feature-row">
              <CheckCircle2 size={18} />
              <span>
                <strong>{feature.title}</strong>
                <small>{feature.problem}</small>
                {feature.description}
              </span>
            </a>
          ))}
        </div>
      </section>
      <section className="section docs-preview">
        <div className="section-heading">
          <h2>Step-by-step documentation</h2>
          <p>Choose a task, follow the complete workflow, then open the engine-specific page for exact capabilities and limitations.</p>
        </div>
        <div className="doc-card-grid">
          {docArticles.filter((article) => article.featured).slice(0, 6).map((article) => (
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
        <ScreenshotAsset id="connection-wizard" compact />
        <ScreenshotAsset id="sql-query-results" compact />
        <ScreenshotAsset id="redis-browser" compact />
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
              <span className="feature-problem">{feature.problem}</span>
              <a href={feature.href}>
                Learn the workflow <ArrowRight size={16} />
              </a>
            </div>
            <ScreenshotAsset id={feature.screenshot} compact />
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
      <PreReleaseNotice />
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
        <ScreenshotAsset id="safety-preview" />
      </section>
    </main>
  )
}

function CoveragePage() {
  return (
    <main className="page-shell">
      <PageTitle
        icon={Network}
        title="Datastore Coverage"
        body="DataPad++ supports native-feeling workflows across SQL, document, cache, search, cloud, local, analytics, metrics, and graph families."
      />
      <section className="coverage-summary" aria-label="Datastore maturity summary">
        <div>
          <strong>{datastoreDocs.length}</strong>
          <span>documented engines</span>
          <p>Every declared datastore has connection, exploration, query, result, transfer, diagnostic, and safety boundaries.</p>
        </div>
        <div>
          <strong>4</strong>
          <span>explicit capability states</span>
          <p>Live, Experimental, Plan only, and Unavailable describe each operation without implying production readiness.</p>
        </div>
        <div>
          <strong>Pre</strong>
          <span>release maturity</span>
          <p>All engines and capabilities remain pre-release. Begin with local, disposable, or read-only targets.</p>
        </div>
      </section>
      <section className="coverage-grid">
        {datastoreGroups.map((group) => (
          <div className="coverage-group" key={group.family}>
            <h2>{group.family}</h2>
            <div>
              {group.engines.map((engine) => {
                const datastoreDoc = getDatastoreDocByName(engine)

                return datastoreDoc ? (
                  <a
                    href={`/docs/datastores/${datastoreDoc.slug}`}
                    aria-label={`Open the ${engine} documentation`}
                    key={engine}
                  >
                    {engine}
                  </a>
                ) : (
                  <span key={engine}>{engine}</span>
                )
              })}
            </div>
          </div>
        ))}
      </section>
      <section className="section split-section">
        <div>
          <h2>Operation-specific, not one broad badge</h2>
          <p>
            Querying, editing, import, export, backup, restore, administration, and cloud control-plane support can differ on the same engine. Each guide states the exact action boundary.
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
      <PreReleaseNotice />
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
    const pageUrl = new URL(window.location.pathname, websiteUrl).toString()
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', pageUrl)
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.setAttribute('content', pageUrl)
  }, [route])

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
        return <DocsExperience slug={route.slug} />
      case 'home':
      default:
        return <HomePage releases={releases} platform={platform} />
    }
  }, [platform, releases, releasesStatus, route])

  return (
    <div className="site-app">
      <Header />
      <PreReleaseNotice compact />
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
