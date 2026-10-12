import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { fetchReleases } from './lib/releases'
import { getSitePage, renderSeoHead } from './lib/seo'

vi.mock('./lib/releases', () => ({ fetchReleases: vi.fn().mockResolvedValue([]) }))

let root: Root | undefined
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.clearAllMocks()
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

async function hydrate(path: string) {
  window.history.replaceState({}, '', path)
  document.head.innerHTML = renderSeoHead(path)
  document.body.innerHTML = `<div id="root">${renderToString(<App initialPath={window.location.pathname} />)}</div>`
  const recover = vi.fn()
  await act(async () => {
    root = hydrateRoot(document.getElementById('root')!, <App />, { onRecoverableError: recover })
  })
  expect(recover).not.toHaveBeenCalled()
}

describe('pre-rendered browser experience', () => {
  it('hydrates guides and restores query-string search without canonical or content mismatches', async () => {
    await hydrate('/docs/first-query?q=postgresql#quickstart')
    expect(document.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('postgresql')
    expect(document.querySelector('h1')?.textContent).toBe(getSitePage('/docs/first-query')!.breadcrumbs.at(-1)!.name)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://datapad-plus-plus.org/docs/first-query')
    expect(fetchReleases).not.toHaveBeenCalled()
  })

  it('hydrates the homepage and still fetches release data', async () => {
    await hydrate('/')
    expect(fetchReleases).toHaveBeenCalledOnce()
    expect(document.querySelector('main h1')?.textContent).toBe('DataPad++')
  })

  it('updates content and metadata on history navigation and closes the mobile drawer', async () => {
    await hydrate('/docs/first-query')
    await act(async () => document.querySelector<HTMLButtonElement>('.learn-docs-mobile-menu')!.click())
    expect(document.querySelector('.learn-docs-nav.is-open')).not.toBeNull()
    await act(async () => {
      window.history.pushState({}, '', '/docs/datastores/mongodb')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(document.querySelector('.learn-docs-nav.is-open')).toBeNull()
    expect(document.title).toBe(getSitePage('/docs/datastores/mongodb')!.title)
    expect(document.querySelector('h1')?.textContent).toBe('MongoDB')
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(fetchReleases).not.toHaveBeenCalled()
    await act(async () => {
      window.history.pushState({}, '', '/no-such-route')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(document.querySelector('h1')?.textContent).toBe('Page not found')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow')
  })
})
