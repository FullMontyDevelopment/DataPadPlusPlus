import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
const screenshotRoot = resolve(repoRoot, 'apps', 'site', 'public', 'screenshots')

async function selectApplicationWindow() {
  const handles = await browser.getWindowHandles()
  for (const handle of handles) {
    await browser.switchToWindow(handle)
    if ((await browser.getUrl()) !== 'about:blank' || (await browser.getTitle())) return
  }
}

async function settle() {
  await browser.pause(220)
  await browser.execute(() => {
    document.getSelection()?.removeAllRanges()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
}

async function capture(name) {
  await settle()
  const path = resolve(screenshotRoot, name)
  try {
    await browser.saveScreenshot(path)
  } catch {
    await browser.pause(300)
    await browser.saveScreenshot(path)
  }
}

async function setSidebarVisible(visible) {
  const current = await browser.execute(() => Boolean(document.querySelector('.workbench-sidebar')))
  if (current === visible) return
  const selector = visible
    ? 'button[aria-label="Show Library"]'
    : 'button[aria-label="Collapse Library sidebar"]'
  const control = await $(selector)
  if (await control.isExisting()) {
    await control.click()
  } else {
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true }))
    })
  }
  await browser.waitUntil(
    async () => browser.execute((expected) => Boolean(document.querySelector('.workbench-sidebar')) === expected, visible),
    { timeout: 10000, timeoutMsg: `Expected the Library sidebar to be ${visible ? 'visible' : 'hidden'}.` },
  )
  await settle()
}

async function isolateLibraryConnection(name) {
  await browser.execute((requestedName) => {
    document.querySelectorAll('.documentation-capture-hidden').forEach((item) => item.classList.remove('documentation-capture-hidden'))
    const button = [...document.querySelectorAll('button.library-tree-label')]
      .find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === requestedName)
    const target = button?.closest('[data-library-node-id]')
    if (!(target instanceof HTMLElement)) return
    document.querySelectorAll('.workbench-sidebar [data-library-node-id]').forEach((item) => {
      if (item !== target && !item.contains(target) && !target.contains(item)) item.classList.add('documentation-capture-hidden')
    })
  }, name)
  await settle()
}

async function clearLibraryIsolation() {
  await browser.execute(() => {
    document.querySelectorAll('.documentation-capture-hidden').forEach((item) => item.classList.remove('documentation-capture-hidden'))
  })
}

async function findLibraryButton(text) {
  const buttons = await $$('button.library-tree-label')
  let partial
  for (const button of buttons) {
    const label = (await button.getText()).replace(/\s+/g, ' ').trim()
    if (label === text) return button
    if (!partial && label.includes(text)) partial = button
  }
  return partial
}

async function activateSavedWork(name) {
  const button = await findLibraryButton(name)
  if (!button) throw new Error(`Unable to find ${name}`)
  await button.scrollIntoView({ block: 'center' })
  await button.click()
  await settle()
}

async function activateOpenTab(title) {
  const activated = await browser.execute((requestedTitle) => {
    const tab = [...document.querySelectorAll('[role="tab"]')]
      .find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').includes(requestedTitle))
    if (!(tab instanceof HTMLElement)) return false
    tab.click()
    return true
  }, title)
  if (!activated) throw new Error(`Unable to activate open tab ${title}`)
  await settle()
}

async function ensureBottomPanel(visible) {
  const panel = await $('.bottom-panel')
  const panelVisible = (await panel.isExisting()) && (await panel.isDisplayed())
  if (panelVisible === visible) return
  const toggle = visible
    ? await $('button[aria-label="Show bottom panel"]')
    : await $('button[aria-label="Hide bottom panel from status bar"]')
  if (!(await toggle.isExisting())) {
    throw new Error(`Unable to ${visible ? 'show' : 'hide'} the results panel.`)
  }
  await toggle.click()
  await settle()
}

async function closeDrawer() {
  const close = await $('button[aria-label="Close drawer"]')
  if (await close.isExisting()) {
    await close.click()
    await settle()
  }
}

async function openConnectionForm(label) {
  await setSidebarVisible(true)
  await closeDrawer()
  const create = await $('button[aria-label="Create connection"]')
  await create.scrollIntoView({ block: 'center' })
  await create.click()
  const trigger = await $('button[aria-label="Database type"]')
  await trigger.waitForClickable({ timeout: 10000 })
  await trigger.click()
  const option = await $(`button[role="option"][aria-label="${label}"]`)
  await option.scrollIntoView({ block: 'center' })
  await option.click()
  await browser.execute(() => {
    const scroll = document.querySelector('.drawer-scroll')
    if (scroll instanceof HTMLElement) scroll.scrollTop = 0
  })
  await settle()
}

async function openSettingsSection(label) {
  const settings = await $('button[aria-label="Open settings"]')
  await settings.click()
  const section = await $(`button=${label}`)
  await section.waitForClickable({ timeout: 10000 })
  await section.click()
  await settle()
}

async function openDocumentValueEditor(fieldName) {
  const firstDocument = await $('button[aria-label^="Expand itm-"]')
  if (await firstDocument.isExisting()) {
    await firstDocument.click()
    await settle()
  }
  const opened = await browser.execute((requestedField) => {
    const row = [...document.querySelectorAll('.document-data-grid-row')]
      .find((candidate) => {
        const field = candidate.querySelector('[data-field-path]')?.getAttribute('data-field-path')
        return field === requestedField || field?.endsWith(`.${requestedField}`)
      })
    if (!(row instanceof HTMLElement)) return false
    const bounds = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + Math.min(bounds.width / 2, 180),
      clientY: bounds.top + Math.min(bounds.height / 2, 14),
    }))
    return true
  }, fieldName)
  if (!opened) throw new Error(`Unable to find document field ${fieldName}.`)
  const edit = await $('button=Edit Value')
  await edit.waitForClickable({ timeout: 10000 })
  await edit.click()
  await settle()
}

describe('common documentation screenshots', () => {
  before(async () => {
    mkdirSync(screenshotRoot, { recursive: true })
    await selectApplicationWindow()
    await browser.setWindowSize(1600, 1000)
    await browser.pause(1200)
    const bootState = await browser.execute(() => ({
      mounted: Boolean(document.querySelector('.ads-shell')),
      text: document.body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1200) ?? '',
      url: location.href,
    }))
    if (!bootState.mounted) {
      throw new Error(`Expected the DataPad++ workbench shell to mount: ${JSON.stringify(bootState)}`)
    }
    await browser.execute(() => {
      const style = document.createElement('style')
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;cursor:none!important;scroll-behavior:auto!important}::selection{background:transparent!important;color:inherit!important}:focus{outline-color:transparent!important}.editor-tab:not(.is-active),.editor-tab-scroll-button,.documentation-capture-hidden{display:none!important}.editor-tab.is-active{max-width:420px!important;min-width:240px!important}.editor-tabs{overflow:hidden!important;scrollbar-width:none!important}'
      document.head.append(style)
    })
  })

  it('captures datastore transfer review and Transfers Center', async () => {
    await setSidebarVisible(false)
    const selected = await browser.execute(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => /table_health/i.test(candidate.textContent ?? ''))
      if (!(tab instanceof HTMLElement)) return false
      tab.click()
      return true
    })
    if (!selected) throw new Error('The transfer example tab was not available.')
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('.object-view-workspace'))),
      { timeout: 20000 },
    )
    const action = await browser.execute(() => {
      const button = [...document.querySelectorAll('.object-view-action-chip')]
        .find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === 'Export')
      if (!(button instanceof HTMLButtonElement)) {
        return {
          clicked: false,
          actions: [...document.querySelectorAll('.object-view-action-chip')]
            .map((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim()),
          activeTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
            .map((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim()),
          objectText: document.querySelector('.object-view-workspace')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        }
      }
      button.click()
      return { clicked: true, actions: [], activeTabs: [], objectText: '' }
    })
    if (!action.clicked) throw new Error(`Transfer example action missing: ${JSON.stringify(action)}`)
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.datastore-transfer-dialog'))), { timeout: 20000 })
    const remoteDestination = await $('.datastore-transfer-wide-field input')
    await remoteDestination.waitForExist({ timeout: 20000 })
    await remoteDestination.setValue('C:/exports/table-health/')
    await settle()
    await capture('datastore-transfer.png')

    const validate = await $('button*=Validate')
    await validate.waitForClickable({ timeout: 20000 })
    await validate.click()
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.datastore-transfer-review'))), { timeout: 20000 })
    const start = await $('button*=Start Export')
    await start.waitForClickable({ timeout: 20000 })
    await start.click()
    const center = await $('.datastore-transfers-center')
    if (!(await center.isExisting())) {
      const close = await $('button[aria-label="Close transfer dialog"]')
      if (await close.isExisting()) await close.click()
      const status = await $('button[aria-label^="Open Transfers Center"]')
      if (await status.isExisting()) await status.click()
    }
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.datastore-transfers-center'))), { timeout: 20000 })
    await capture('transfer-center.png')
    const closeCenter = await $('button[aria-label="Close Transfers Center"]')
    if (await closeCenter.isExisting()) await closeCenter.click()
  })

  it('captures dedicated document, key-value, and Oracle views', async () => {
    await setSidebarVisible(false)
    await activateOpenTab('Commerce Catalog MongoDB')
    await ensureBottomPanel(true)
    await capture('mongodb-builder.png')
    await openDocumentValueEditor('sku')
    await capture('document-editor.png')
    const editInput = await $('input[aria-label="Edit value sku"]')
    await editInput.setValue('luna-lamp-featured')
    await capture('import-export.png')
    const cancelEdit = await $('button=Cancel')
    if (await cancelEdit.isExisting()) {
      await cancelEdit.click()
      await settle()
    }

    await activateOpenTab('Realtime Cache Redis')
    await ensureBottomPanel(true)
    await capture('redis-browser.png')
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('.keyvalue-result-entry'))),
      { timeout: 10000, timeoutMsg: 'Expected a Redis result entry before opening its context menu.' },
    )
    const keyMenuOpened = await browser.execute(() => {
      const entry = document.querySelector('.keyvalue-result-entry')
      if (!(entry instanceof HTMLElement)) return false
      const bounds = entry.getBoundingClientRect()
      entry.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + Math.min(bounds.width / 2, 180),
        clientY: bounds.top + Math.min(bounds.height / 2, 14),
      }))
      return true
    })
    if (!keyMenuOpened) throw new Error('Unable to open the key-value entry menu.')
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label^="Key options for"]'))),
      { timeout: 10000 },
    )
    await capture('key-value-inspector.png')
    await browser.keys('Escape')

    await activateOpenTab('Search Catalog OpenSearch')
    await ensureBottomPanel(true)
    await capture('search-diagnostics.png')

    await activateOpenTab('Serverless Orders DynamoDB')
    await ensureBottomPanel(false)
    await capture('typed-query-builder.png')

    await activateOpenTab('Finance Operations Oracle')
    await capture('oracle-paging.png')
  })

  it('captures Library, Explorer, results, relationships, tabs, and connection setup', async () => {
    await activateOpenTab('Northwind Analytics PostgreSQL')
    await ensureBottomPanel(false)
    await setSidebarVisible(true)
    await isolateLibraryConnection('Northwind Analytics PostgreSQL')
    await capture('library-environments.png')
    await clearLibraryIsolation()

    const connectionMenuOpened = await browser.execute(() => {
      const connection = [...document.querySelectorAll('button.library-tree-label')]
        .find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === 'Northwind Analytics PostgreSQL')
      if (!(connection instanceof HTMLElement)) return false
      connection.scrollIntoView({ block: 'center' })
      const bounds = connection.getBoundingClientRect()
      connection.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + Math.min(bounds.width / 2, 120),
        clientY: bounds.top + Math.min(bounds.height / 2, 14),
      }))
      return true
    })
    if (!connectionMenuOpened) throw new Error('Unable to open the PostgreSQL connection menu.')
    const openExplorer = await $('button[aria-label="Open Explorer for Northwind Analytics PostgreSQL"]')
    await openExplorer.waitForClickable({ timeout: 10000 })
    await openExplorer.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label="PostgreSQL Explorer"]'))),
      { timeout: 20000 },
    )
    await capture('explorer-tree.png')
    await setSidebarVisible(false)
    const relationshipMap = await $('button=Relationship map')
    await relationshipMap.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label="Visual database structure"]'))),
      { timeout: 20000 },
    )
    await capture('relationship-explorer.png')

    await activateOpenTab('Northwind Analytics PostgreSQL')
    await ensureBottomPanel(true)
    await capture('sql-query-results.png')
    await capture('hero-workbench.png')
    const exportResult = await $('button[aria-label="Export result"]')
    await exportResult.waitForClickable({ timeout: 10000 })
    await exportResult.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('.result-export-dialog'))),
      { timeout: 10000 },
    )
    await capture('result-export.png')
    const cancelExport = await $('button=Cancel')
    await cancelExport.click()

    await activateOpenTab('Order data smoke tests')
    await capture('test-suites.png')

    await activateOpenTab('Serverless Orders DynamoDB')
    const menuOpened = await browser.execute(() => {
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"]')
      if (!(activeTab instanceof HTMLElement)) return false
      const bounds = activeTab.getBoundingClientRect()
      activeTab.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + Math.min(bounds.width / 2, 100),
        clientY: bounds.top + Math.min(bounds.height / 2, 16),
      }))
      return true
    })
    if (!menuOpened) throw new Error('Unable to open the active tab context menu.')
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[role="menu"]'))),
      { timeout: 10000 },
    )
    await capture('multi-window-tabs.png')
    await browser.keys('Escape')

    await openConnectionForm('PostgreSQL')
    await setSidebarVisible(false)
    await capture('connection-wizard.png')
    await closeDrawer()
  })

  it('captures service workspaces, search, settings, updates, and workspace import', async () => {
    await setSidebarVisible(true)
    const workspaceSearch = await $('button[aria-label="Open Workspace Search"]')
    await workspaceSearch.scrollIntoView({ block: 'center' })
    await workspaceSearch.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label="Workspace Search"]'))),
      { timeout: 10000 },
    )
    await setSidebarVisible(false)
    const searchInput = await $('input[aria-label="Search workspace"]')
    await searchInput.setValue('orders')
    await settle()
    await capture('workspace-search.png')

    const api = await $('button[aria-label^="Open API Server workspace"]')
    await api.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label="API Server workspace"]'))),
      { timeout: 10000 },
    )
    await capture('api-server.png')

    const mcp = await $('button[aria-label^="Open MCP Server workspace"]')
    await mcp.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[aria-label="MCP Server workspace"]'))),
      { timeout: 10000 },
    )
    await capture('mcp-server.png')

    await openSettingsSection('Workspace + Backups')
    await capture('settings-backups.png')
    const workspaceTransfer = await $('section[aria-label="Workspace transfer"]')
    const importWorkspace = await workspaceTransfer.$('button=Import')
    await importWorkspace.click()
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('.workspace-transfer-dialog'))),
      { timeout: 10000 },
    )
    await capture('workspace-import-review.png')
    const importDialog = await $('.workspace-transfer-dialog')
    const cancelImport = await importDialog.$('button=Cancel')
    await cancelImport.click()

    const security = await $('button=Security')
    await security.click()
    await settle()
    await capture('safety-preview.png')

    const updates = await $('button=Updates')
    await updates.click()
    await settle()
    await capture('download-release.png')
  })
})
