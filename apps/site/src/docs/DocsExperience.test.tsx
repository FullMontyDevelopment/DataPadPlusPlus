import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocsExperience } from './DocsExperience'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))

describe('Learn-style documentation renderer', () => {
  it('renders procedures, figures, callouts, tables, breadcrumbs, and heading anchors', () => {
    const markup = renderToStaticMarkup(<DocsExperience slug="first-query" />)

    expect(markup).toContain('class="learn-docs-procedure"')
    expect(markup).toContain('class="learn-docs-figure"')
    expect(markup).toContain('learn-docs-callout tone-warning')
    expect(markup).toContain('class="learn-docs-table-wrap"')
    expect(markup).toContain('aria-label="Breadcrumb"')
    expect(markup).toContain('href="#quickstart"')
    expect(markup).toContain('aria-label="In this article"')
  })

  it('renders datastore code-copy controls and complete reference sections', () => {
    const markup = renderToStaticMarkup(<DocsExperience slug="datastores/postgresql" />)

    expect(markup).toContain('class="learn-docs-code"')
    expect(markup).toContain('aria-label="Copy PostgreSQL read-only example code"')
    expect(markup).toContain('Connection fields')
    expect(markup).toContain('Capabilities and availability')
    expect(markup).toContain('Troubleshooting')
    expect(markup).toContain('/screenshots/datastores/postgresql-connection.png')
    expect(markup).toContain('/screenshots/datastores/postgresql-workflow.png')
  })

  it('renders the complete plugin catalog and screenshot-backed plugin guides', () => {
    const catalog = renderToStaticMarkup(<DocsExperience slug="plugins" />)
    const workspaces = renderToStaticMarkup(<DocsExperience slug="plugin-workspaces" />)

    expect(catalog).toContain('Choose And Manage Plugins')
    expect(catalog).toContain('Workspace Search')
    expect(catalog).toContain('Multi-window Tabs')
    expect(catalog).toContain('Datastore Tests')
    expect(catalog).toContain('/screenshots/plugins-ready.png')
    expect(catalog).toContain('/screenshots/plugins-experimental.png')
    expect(workspaces).toContain('Use The Workspaces Plugin')
    expect(workspaces).toContain('Features')
    expect(workspaces).toContain('Availability and data boundary')
    expect(workspaces).toContain('/screenshots/workspace-switcher.png')
  })

  it('keeps responsive navigation and tablet contents rules scoped to docs', () => {
    const styles = readFileSync(resolve(sourceDirectory, '..', 'styles.css'), 'utf8')

    expect(styles).toContain('@media (max-width: 1180px)')
    expect(styles).toContain('@media (max-width: 860px)')
    expect(styles).toContain('.learn-docs-nav.is-open')
    expect(styles).toContain('.learn-docs-drawer-scrim')
    expect(styles).toContain('.learn-docs-tablet-toc')
  })
})
