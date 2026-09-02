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
  ['litedb', 'LiteDB', 'Customer Archive LiteDB'],
  ['redis', 'Redis', 'Realtime Cache Redis'],
  ['valkey', 'Valkey', 'Edge Cache Valkey'],
  ['memcached', 'Memcached', 'Feature Flag Memcached'],
  ['elasticsearch', 'Elasticsearch', 'Search Orders Elasticsearch'],
  ['opensearch', 'OpenSearch', 'Search Catalog OpenSearch'],
  ['clickhouse', 'ClickHouse', 'Warehouse Events ClickHouse'],
  ['duckdb', 'DuckDB', 'Finance Analysis DuckDB'],
  ['snowflake', 'Snowflake', 'Revenue Warehouse Snowflake'],
  ['bigquery', 'BigQuery', 'Marketing Analytics BigQuery'],
  ['influxdb', 'InfluxDB', 'Latency Metrics InfluxDB'],
  ['timescaledb', 'TimescaleDB', 'Order Metrics TimescaleDB'],
  ['prometheus', 'Prometheus', 'Service Health Prometheus'],
  ['opentsdb', 'OpenTSDB', 'Telemetry OpenTSDB'],
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
      .editor-tab:not(.is-active),
      .editor-tab-scroll-button,
      .documentation-capture-hidden { display: none !important; }
      .editor-tab.is-active { max-width: 420px !important; min-width: 240px !important; }
      .editor-tabs { overflow: hidden !important; scrollbar-width: none !important; }
    `
    document.head.append(style)
  })
}

async function capture(path) {
  await settle()
  try {
    await browser.saveScreenshot(path)
  } catch {
    await browser.pause(300)
    await browser.saveScreenshot(path)
  }
}

async function closeDrawer() {
  const close = await $('button[aria-label="Close drawer"]')
  if (await close.isExisting()) {
    await close.click()
    await settle()
  }
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

async function openConnectionForm(label) {
  await closeDrawer()
  const create = await $('button[aria-label="Create connection"]')
  await create.scrollIntoView({ block: 'center' })
  await create.waitForClickable({ timeout: 10000 })
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

async function populateConnectionForm(engine, name) {
  const setFieldValue = async (selector, value) => {
    const field = await $(selector)
    if (await field.isExisting()) await field.setValue(value)
  }
  const nameInput = await $('//*[normalize-space(text())="Name"]/following::input[1]')
  if (await nameInput.isExisting()) await nameInput.setValue(name)
  if (engine === 'sqlite') await setFieldValue('input[aria-label="Database file"]', 'C:/data/application.db')
  if (engine === 'litedb') await setFieldValue('input[aria-label="Database file"]', 'C:/data/customer-archive.litedb')
  if (engine === 'duckdb') await setFieldValue('input[aria-label="Database file"]', 'C:/data/analytics.duckdb')
  if (engine === 'dynamodb') await setFieldValue('input[aria-label="DynamoDB endpoint URL"]', 'https://dynamodb.us-east-1.amazonaws.com')
  if (engine === 'cosmosdb') await setFieldValue('input[aria-label="Cosmos DB account endpoint"]', 'https://example-account.documents.azure.com')
  if (engine === 'elasticsearch' || engine === 'opensearch') await setFieldValue('input[aria-label="Search endpoint URL"]', 'https://search.example.com')
  if (engine === 'clickhouse') await setFieldValue('input[aria-label="Warehouse endpoint URL"]', 'https://clickhouse.example.com:8443')
  if (engine === 'snowflake') await setFieldValue('input[aria-label="Warehouse endpoint URL"]', 'https://xy12345.eu-west-1.snowflakecomputing.com')
  if (engine === 'bigquery') await setFieldValue('input[aria-label="Warehouse endpoint URL"]', 'https://bigquery.googleapis.com')
  if (engine === 'influxdb') await setFieldValue('input[aria-label="Time-series endpoint URL"]', 'https://influx.example.com')
  if (engine === 'prometheus') await setFieldValue('input[aria-label="Time-series endpoint URL"]', 'https://prometheus.example.com')
  if (engine === 'opentsdb') await setFieldValue('input[aria-label="Time-series endpoint URL"]', 'https://opentsdb.example.com')
  if (engine === 'neo4j') await setFieldValue('input[aria-label="Graph endpoint URL"]', 'neo4j+s://example.databases.neo4j.io')
  if (engine === 'neptune') await setFieldValue('input[aria-label="Graph endpoint URL"]', 'wss://example.cluster.us-east-1.neptune.amazonaws.com:8182/gremlin')
  if (engine === 'arango') await setFieldValue('input[aria-label="Graph endpoint URL"]', 'https://arango.example.com')
  if (engine === 'janusgraph') await setFieldValue('input[aria-label="Graph endpoint URL"]', 'wss://graph.example.com/gremlin')
  await settle()
}

async function saveDocumentationConnection() {
  const save = await $('button=Save Connection')
  await save.click()
  await settle()
}

describe('Microsoft Learn documentation screenshots', () => {
  before(async () => {
    mkdirSync(datastoreRoot, { recursive: true })
    await selectApplicationWindow()
    await browser.setWindowSize(1600, 1000)
    try {
      await browser.waitUntil(
        async () => browser.execute(() => Boolean(document.querySelector('.ads-shell'))),
        { timeout: 30000, timeoutMsg: 'Expected the DataPad++ workbench shell to mount.' },
      )
    } catch (error) {
      const bootState = await browser.execute(() => ({
        text: document.body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1600) ?? '',
        html: document.body.innerHTML.slice(0, 1600),
        url: location.href,
      }))
      throw new Error(`Expected the DataPad++ workbench shell to mount: ${JSON.stringify(bootState)}`, { cause: error })
    }
    await installCaptureCss()
  })

  it('captures the pointer-free workbench and every datastore connection form', async () => {
    for (const [engine, label, name] of engines) {
      await openConnectionForm(label)
      await populateConnectionForm(engine, name)
      await browser.execute(() => {
        const scroll = document.querySelector('.drawer-scroll')
        if (scroll instanceof HTMLElement) scroll.scrollTop = 0
      })
      await settle()
      await isolateLibraryConnection('Northwind Analytics PostgreSQL')
      await capture(resolve(datastoreRoot, `${engine}-connection.png`))
      await clearLibraryIsolation()
      if (['litedb', 'duckdb', 'opentsdb'].includes(engine) && !(await visibleLibraryButton(name))) {
        await saveDocumentationConnection()
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
      await isolateLibraryConnection(name)
      await capture(resolve(datastoreRoot, `${engine}-workflow.png`))
      await clearLibraryIsolation()
    }
  })
})
