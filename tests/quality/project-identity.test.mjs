import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const OFFICIAL_WEBSITE_URL = 'https://datapad-plus-plus.org/'
const REPOSITORY_URL = 'https://github.com/FullMontyDevelopment/DataPadPlusPlus.git'
const ISSUE_URL = 'https://github.com/FullMontyDevelopment/DataPadPlusPlus/issues'

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('workspace package metadata uses the official project destinations', async () => {
  const packagePaths = [
    'package.json',
    'apps/desktop/package.json',
    'apps/site/package.json',
    'packages/shared-types/package.json',
  ]

  for (const path of packagePaths) {
    const manifest = JSON.parse(await read(path))
    assert.equal(manifest.homepage, OFFICIAL_WEBSITE_URL, `${path} homepage`)
    assert.equal(manifest.repository?.url, REPOSITORY_URL, `${path} repository`)
    assert.equal(manifest.bugs?.url, ISSUE_URL, `${path} issue tracker`)
  }
})

test('website metadata declares and updates the canonical official URL', async () => {
  const [index, product, app] = await Promise.all([
    read('apps/site/index.html'),
    read('apps/site/src/data/product.ts'),
    read('apps/site/src/App.tsx'),
  ])

  assert.match(index, /rel="canonical" href="https:\/\/datapad-plus-plus\.org\/"/)
  assert.match(index, /property="og:url" content="https:\/\/datapad-plus-plus\.org\/"/)
  assert.match(product, /websiteUrl = 'https:\/\/datapad-plus-plus\.org\/'/)
  assert.match(app, /new URL\(window\.location\.pathname, websiteUrl\)/)
  assert.match(app, /<img src="\/favicon\.png" alt="" \/>/)
  assert.doesNotMatch(app, /desktop\/public\/favicon\.svg/)
})

test('desktop and generated project surfaces retain official website attribution', async () => {
  const [about, externalLinks, capabilities, generatedDocs] = await Promise.all([
    read('apps/desktop/src/app/components/workbench/SettingsAboutPanel.tsx'),
    read('apps/desktop/src/services/runtime/external-links.ts'),
    read('apps/desktop/src-tauri/capabilities/default.json'),
    read(
      'apps/desktop/src-tauri/src/app/runtime/datastore_api_server/project_export/frameworks/common.rs',
    ),
  ])

  for (const source of [about, externalLinks, capabilities, generatedDocs]) {
    assert.match(source, /https:\/\/datapad-plus-plus\.org/)
  }
})
