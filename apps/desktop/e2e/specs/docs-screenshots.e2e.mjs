import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
const screenshotRoot = resolve(repoRoot, 'apps', 'site', 'public', 'screenshots')
const datastoreRoot = resolve(screenshotRoot, 'datastores')

const engines = [
  ['postgresql', 'PostgreSQL', 'Northwind Analytics PostgreSQL'],
  ['cockroachdb', 'CockroachDB', 'Regional Accounts CockroachDB'],
  ['sqlserver', 'SQL Server / Azure SQL', 'Operations SQL Server'],
  ['mysql', 'MySQL', 'Inventory MySQL'],
  ['mariadb', 'MariaDB', 'Orders MariaDB'],
  ['sqlite', 'SQLite', 'Local Accounts SQLite'],
  ['oracle', 'Oracle', 'Finance Operations Oracle'],
  ['mongodb', 'MongoDB', 'Commerce Catalog MongoDB'],
  ['dynamodb', 'DynamoDB', 'Serverless Orders DynamoDB'],
  ['cassandra', 'Cassandra', 'Order Ledger Cassandra'],
  ['cosmosdb', 'Cosmos DB', 'Customer Profiles Cosmos DB'],
  ['litedb', 'LiteDB', 'Documentation LiteDB'],
  ['redis', 'Redis', 'Realtime Cache Redis'],
  ['valkey', 'Valkey', 'Edge Cache Valkey'],
  ['memcached', 'Memcached', 'Feature Flag Memcached'],
  ['elasticsearch', 'Elasticsearch', 'Search Orders Elasticsearch'],
  ['opensearch', 'OpenSearch', 'Search Catalog OpenSearch'],
  ['clickhouse', 'ClickHouse', 'Warehouse Events ClickHouse'],
  ['duckdb', 'DuckDB', 'Documentation DuckDB'],
  ['snowflake', 'Snowflake', 'Revenue Warehouse Snowflake'],
  ['bigquery', 'BigQuery', 'Marketing Analytics BigQuery'],
  ['influxdb', 'InfluxDB', 'Latency Metrics InfluxDB'],
  ['timescaledb', 'TimescaleDB', 'Order Metrics TimescaleDB'],
  ['prometheus', 'Prometheus', 'Service Health Prometheus'],
  ['opentsdb', 'OpenTSDB', 'Documentation OpenTSDB'],
  ['neo4j', 'Neo4j', 'Customer Journey Neo4j'],
  ['neptune', 'Amazon Neptune', 'Recommendation Graph Neptune'],
  ['arango', 'ArangoDB', 'Graph Catalog ArangoDB'],
  ['janusgraph', 'JanusGraph', 'Network Signals JanusGraph'],
]

async function selectApplicationWindow() {
  const handles = await browser.getWindowHandles()
  for (const handle of handles) {
    await browser.switchToWindow(handle)
    if ((await browser.getUrl()) !== 'about:blank' || (await browser.getTitle())) return
  }
}

async function settle() {
  await browser.pause(180)
  await browser.execute(() => {
    document.getSelection()?.removeAllRanges()
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    document.documentElement.dataset.documentationCapture = 'true'
  })
}

async function installCaptureCss() {
  await browser.execute(() => {
    const style = document.createElement('style')
    style.id = 'documentation-capture-style'
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        cursor: none !important;
        scroll-behavior: auto !important;
      }
      ::selection { background: transparent !important; color: inherit !important; }
      :focus { outline-color: transparent !important; }
    `
    document.head.append(style)
  })
}

async function capture(path) {
  await settle()
  await browser.saveScreenshot(path)
}

async function closeDrawer() {
  const close = await $('button[aria-label="Close drawer"]')
  if (await close.isExisting()) {
    await close.click()
    await settle()
  }
}

async function openConnectionForm(label) {
  await closeDrawer()
  const create = await $('button[aria-label="Create connection"]')
  await create.scrollIntoView({ block: 'center' })
  await create.click()
  const trigger = await $('button[aria-label="Database type"]')
  await trigger.click()
  const option = await $(`button[role="option"][aria-label="${label}"]`)
  await option.scrollIntoView({ block: 'center' })
  await option.click()
  await settle()
}

async function visibleLibraryButton(text) {
  const buttons = await $$('button.library-tree-label')
  let partial
  for (const button of buttons) {
    const label = (await button.getText()).replace(/\s+/g, ' ').trim()
    if (label === text) return button
    if (!partial && label.includes(text)) partial = button
  }
  return partial
}

async function saveDocumentationConnection(engine, name) {
  const nameInput = await $('//*[normalize-space(text())="Name"]/following::input[1]')
  if (await nameInput.isExisting()) await nameInput.setValue(name)
  if (engine === 'litedb') {
    const file = await $('input[aria-label="Database file"]')
    if (await file.isExisting()) await file.setValue('C:/fixtures/documentation.litedb')
  }
  if (engine === 'duckdb') {
    const file = await $('input[aria-label="Database file"]')
    if (await file.isExisting()) await file.setValue(':memory:')
  }
  if (engine === 'opentsdb') {
    const endpoint = await $('input[aria-label="Time-series endpoint URL"]')
    if (await endpoint.isExisting()) await endpoint.setValue('http://127.0.0.1:4242')
  }
  const save = await $('button=Save Connection')
  await save.click()
  await settle()
}

describe('Microsoft Learn documentation screenshots', () => {
  before(async () => {
    mkdirSync(datastoreRoot, { recursive: true })
    await selectApplicationWindow()
    await browser.setWindowSize(1600, 1000)
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('.ads-shell'))),
      { timeout: 30000, timeoutMsg: 'Expected the DataPad++ workbench shell to mount.' },
    )
    await installCaptureCss()
  })

  it('captures the pointer-free workbench and every datastore connection form', async () => {
    await capture(resolve(screenshotRoot, 'hero-workbench.png'))
    for (const [engine, label, name] of engines) {
      await openConnectionForm(label)
      await capture(resolve(datastoreRoot, `${engine}-connection.png`))
      if (['litedb', 'duckdb', 'opentsdb'].includes(engine) && !(await visibleLibraryButton(name))) {
        await saveDocumentationConnection(engine, name)
      } else {
        await closeDrawer()
      }
    }
  })

  it('captures a representative native workflow for every datastore', async () => {
    await closeDrawer()
    for (const [engine, , name] of engines) {
      const button = await visibleLibraryButton(name)
      if (!button) throw new Error(`Unable to find screenshot connection: ${name}`)
      await button.scrollIntoView({ block: 'center' })
      await button.doubleClick()
      await settle()
      await capture(resolve(datastoreRoot, `${engine}-workflow.png`))
    }
  })
})
