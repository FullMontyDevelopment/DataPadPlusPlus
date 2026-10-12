import { renderToString } from 'react-dom/server'
import { App } from './App'
export { renderSeoHead, renderSitemap, renderLlmsIndex, sitePages } from './lib/seo'

export function render(pathname: string): string {
  return renderToString(<App initialPath={pathname} />)
}
