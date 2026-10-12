import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sitePages } from '../.prerender/entry-server.js'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const origin = 'https://datapad-plus-plus.org'
const pathToFile = (path) => resolve(output, path === '/' ? 'index.html' : `${path.slice(1)}.html`)
const pages = new Map(sitePages.map((page) => [page.path, readFileSync(pathToFile(page.path), 'utf8')]))
const titles = new Set()
const descriptions = new Set()
const sitemap = readFileSync(resolve(output, 'sitemap.xml'), 'utf8')
assert.equal([...sitemap.matchAll(/<loc>/g)].length, sitePages.length, 'Sitemap must cover exactly the canonical pages')

for (const [path, html] of pages) {
  const label = `SEO: ${path}`
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? ''
  const title = head.match(/<title>(.*?)<\/title>/)?.[1]
  const description = head.match(/name="description" content="([^"]+)"/)?.[1]
  assert.ok(title && description, `${label}: title and description are required`)
  assert.ok(!titles.has(title), `${label}: duplicate title`)
  assert.ok(!descriptions.has(description), `${label}: duplicate description`)
  titles.add(title)
  descriptions.add(description)
  assert.equal([...head.matchAll(/<title>/g)].length, 1, label)
  assert.equal([...head.matchAll(/rel="canonical"/g)].length, 1, label)
  assert.ok(head.includes(`rel="canonical" href="${origin}${path}"`), `${label}: incorrect canonical URL`)
  assert.ok(head.includes(`property="og:url" content="${origin}${path}"`), `${label}: incorrect social URL`)
  assert.ok(head.includes('summary_large_image'), label)
  assert.ok(!head.includes('noindex'), `${label}: canonical page must be indexable`)
  assert.ok(html.includes('Pre-release software'), `${label}: safety warning must remain visible`)
  assert.ok(!html.includes('<div id="root"></div>'), `${label}: empty client-only shell`)
  assert.equal([...html.matchAll(/<h1(?:>|\s)/g)].length, 1, `${label}: one primary heading`)
  assert.equal([...html.matchAll(/<main(?:>|\s)/g)].length, 1, `${label}: one main landmark`)
  assert.ok(sitemap.includes(`<loc>${origin}${path}</loc>`), `${label}: missing sitemap URL`)
  const graph = JSON.parse(head.match(/<script type="application\/ld\+json" id="site-structured-data">([\s\S]*?)<\/script>/)?.[1] ?? '')
  assert.equal(graph['@context'], 'https://schema.org', label)
  assert.ok(graph['@graph'].some((node) => node.url === `${origin}${path}`), `${label}: structured page URL`)

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replace(/&amp;/g, '&')
    if (!href.startsWith('/') && !href.startsWith('#')) continue
    const url = new URL(href, `${origin}${path}`)
    if (url.origin !== origin) continue
    const targetHtml = pages.get(url.pathname)
    if (targetHtml) {
      if (url.hash) assert.ok(targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${label}: missing anchor ${href}`)
    } else {
      assert.ok(existsSync(resolve(output, `.${url.pathname}`)), `${label}: missing internal page or asset ${href}`)
    }
  }
}
const notFound = readFileSync(resolve(output, '404.html'), 'utf8')
assert.ok(notFound.includes('noindex, follow') && notFound.includes('Page not found'))
assert.ok(!notFound.includes('rel="canonical"'), '404 must not canonicalize to a real page')
const redirects = readFileSync(resolve(output, '_redirects'), 'utf8')
assert.ok(!redirects.includes('/* /index.html 200'), 'No catch-all soft 404')
assert.ok(redirects.includes('/downloads /download 301'), 'Preserve the legacy download URL')
assert.ok(redirects.includes('/downloads/ /download 301'), 'Normalize the legacy trailing slash')
for (const page of sitePages.filter((page) => page.path !== '/')) {
  assert.ok(redirects.includes(`${page.path}/ ${page.path} 301`), `Missing slash redirect: ${page.path}`)
}
const robots = readFileSync(resolve(output, 'robots.txt'), 'utf8')
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`))
assert.match(robots, /User-agent: \*\r?\nAllow: \/(?:\r?\n|$)/, 'Allow public search and AI search crawlers')
const headers = readFileSync(resolve(output, '_headers'), 'utf8').replace(/\r\n/g, '\n')
const headerRules = headers.split(/\n\s*\n/).map((rule) => rule.replace(/^#.*\n/gm, '').trim())
assert.ok(headerRules.includes('https://datapadplusplus.pages.dev/*\n  X-Robots-Tag: noindex'), 'Duplicate hosting domain must not be indexed')
assert.ok(headerRules.includes('https://:branch.datapadplusplus.pages.dev/*\n  X-Robots-Tag: noindex'), 'Preview branches must not be indexed')
assert.ok(headerRules.filter((rule) => /X-Robots-Tag:/i.test(rule)).every((rule) => rule.startsWith('https://') && rule.split('\n')[0].endsWith('.pages.dev/*')), 'Never apply preview noindex to the production custom domain')
for (const [file, contentType] of [['robots.txt', 'text/plain'], ['llms.txt', 'text/plain'], ['sitemap.xml', 'application/xml']]) {
  assert.ok(headerRules.includes(`/${file}\n  Content-Type: ${contentType}; charset=utf-8`), `Incorrect crawler content type: ${file}`)
}
const llms = readFileSync(resolve(output, 'llms.txt'), 'utf8')
for (const page of sitePages) assert.ok(llms.includes(`${origin}${page.path})`), `AI index missing ${page.path}`)
console.log(`SEO checks passed for ${pages.size} static pages: metadata, structured data, headings, links, assets, sitemap, crawler files and 404.`)
