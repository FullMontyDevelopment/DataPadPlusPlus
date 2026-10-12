import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, renderSeoHead, renderSitemap, renderLlmsIndex, sitePages } from '../.prerender/entry-server.js'

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(siteRoot, 'dist')
const template = await readFile(resolve(outputRoot, 'index.html'), 'utf8')
if (!template.includes('<div id="root"></div>') || !template.includes('<!-- seo:start -->')) {
  throw new Error('The site HTML template is missing its pre-render placeholders.')
}
if (new Set(sitePages.map((page) => page.path)).size !== sitePages.length) {
  throw new Error('Duplicate canonical routes in the website catalog.')
}
for (const pathname of [...sitePages.map((page) => page.path), '/404']) {
  if (pathname !== '/' && !/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(pathname)) {
    throw new Error(`Invalid static website route: ${pathname}`)
  }
  const file = resolve(outputRoot, pathname === '/' ? 'index.html' : `${pathname.slice(1)}.html`)
  await mkdir(dirname(file), { recursive: true })
  const html = template
    .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, () => renderSeoHead(pathname))
    .replace('<div id="root"></div>', () => `<div id="root">${render(pathname)}</div>`)
  await writeFile(file, html)
}
await writeFile(resolve(outputRoot, 'sitemap.xml'), renderSitemap())
await writeFile(resolve(outputRoot, 'llms.txt'), renderLlmsIndex())
const redirects = await readFile(resolve(outputRoot, '_redirects'), 'utf8')
await writeFile(resolve(outputRoot, '_redirects'), `${redirects}\n${sitePages.filter((page) => page.path !== '/').map((page) => `${page.path}/ ${page.path} 301`).join('\n')}\n`)
console.log(`Pre-rendered ${sitePages.length} canonical pages, a 404 page, sitemap and AI documentation index.`)
