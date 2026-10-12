// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { render, sitePages } from './entry-server'

describe('crawler-readable rendering without browser globals', () => {
  it.each(sitePages.map((page) => [page.path]))('renders a complete page at %s without JavaScript', (path) => {
    expect(typeof window).toBe('undefined')
    const html = render(path!)
    expect(html).toContain('<h1>')
    expect(html).toContain('Pre-release software')
    expect(html.match(/<main(?:>|\s)/g)).toHaveLength(1)
    expect(html.match(/<h1(?:>|\s)/g)).toHaveLength(1)
    expect(html).not.toContain('Page not found')
  })

  it('renders helpful missing pages rather than duplicate home pages', () => {
    expect(render('/not-a-page')).toContain('Page not found')
    expect(render('/docs/missing')).toContain('Page not found')
    expect(render('/not-a-page')).not.toContain('hero-section')
  })

  it('includes actual guide content and navigation in initial HTML', () => {
    const html = render('/docs/datastores/postgresql')
    expect(html).toContain('Connection fields')
    expect(html).toContain('Troubleshooting')
    expect(html).toContain('Capabilities and availability')
    expect(html).toContain('href="/docs/datastores"')
  })
})
