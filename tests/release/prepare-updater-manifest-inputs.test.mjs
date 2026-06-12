import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  findReleaseByTag,
  prepareUpdaterManifestInputs
} from './prepare-updater-manifest-inputs.mjs'

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function bytesResponse(value, status = 200) {
  return new Response(value, { status })
}

function release(tagName, assets = [], extra = {}) {
  return {
    id: 123,
    tag_name: tagName,
    draft: true,
    prerelease: false,
    assets,
    ...extra
  }
}

function signatureAsset(name, id = 1) {
  return {
    id,
    name,
    url: `https://api.github.com/repos/example/project/releases/assets/${id}`,
    browser_download_url: `https://github.com/example/project/releases/download/app-v1.2.3/${name}`
  }
}

test('prepares manifest inputs from an authenticated draft release listing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-updater-inputs-'))
  const calls = []
  const draftRelease = release('app-v1.2.3', [
    signatureAsset('DataPad++_1.2.3_x64-setup.exe.sig', 42),
    {
      name: 'DataPad++_1.2.3_x64-setup.exe',
      browser_download_url: 'https://example.test/DataPad++_1.2.3_x64-setup.exe'
    }
  ])

  const fetchImpl = async (url, options) => {
    calls.push({ url, accept: options.headers.Accept })
    if (String(url).endsWith('/releases?per_page=100&page=1')) {
      return jsonResponse([draftRelease])
    }
    if (String(url).endsWith('/releases/assets/42')) {
      return bytesResponse('windows-signature\n')
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  const result = await prepareUpdaterManifestInputs({
    repository: 'example/project',
    tagName: 'app-v1.2.3',
    outputDir: root,
    token: 'token',
    fetchImpl
  })

  assert.equal(result.release.draft, true)
  assert.equal(result.signaturePaths.length, 1)
  assert.equal(JSON.parse(readFileSync(join(root, 'release.json'), 'utf8')).tag_name, 'app-v1.2.3')
  assert.equal(readFileSync(join(root, 'DataPad++_1.2.3_x64-setup.exe.sig'), 'utf8'), 'windows-signature\n')
  assert.equal(calls[0].accept, 'application/vnd.github+json')
  assert.equal(calls[1].accept, 'application/octet-stream')
})

test('paginates release listings until the matching tag is found', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => release(`app-v0.0.${index}`))
  const fetchImpl = async (url) => {
    if (String(url).endsWith('page=1')) {
      return jsonResponse(firstPage)
    }
    if (String(url).endsWith('page=2')) {
      return jsonResponse([release('app-v1.2.3')])
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  const found = await findReleaseByTag({
    repository: 'example/project',
    tagName: 'app-v1.2.3',
    token: 'token',
    fetchImpl
  })

  assert.equal(found.tag_name, 'app-v1.2.3')
})

test('fails clearly when the release tag is not in the authenticated listing', async () => {
  await assert.rejects(
    () => findReleaseByTag({
      repository: 'example/project',
      tagName: 'app-v9.9.9',
      token: 'token',
      fetchImpl: async () => jsonResponse([release('app-v1.2.3')])
    }),
    /app-v9\.9\.9/
  )
})

test('rejects unsafe signature asset names before writing them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-updater-inputs-'))

  await assert.rejects(
    () => prepareUpdaterManifestInputs({
      repository: 'example/project',
      tagName: 'app-v1.2.3',
      outputDir: root,
      token: 'token',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases?')) {
          return jsonResponse([release('app-v1.2.3', [signatureAsset('../evil.sig')])])
        }
        return bytesResponse('signature')
      }
    }),
    /not safe to write/
  )

  assert.equal(existsSync(join(root, '..', 'evil.sig')), false)
})

test('rejects Windows-style path separators in signature asset names', async () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-updater-inputs-'))

  await assert.rejects(
    () => prepareUpdaterManifestInputs({
      repository: 'example/project',
      tagName: 'app-v1.2.3',
      outputDir: root,
      token: 'token',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases?')) {
          return jsonResponse([release('app-v1.2.3', [signatureAsset('..\\evil.sig')])])
        }
        return bytesResponse('signature')
      }
    }),
    /not safe to write/
  )
})

test('fails clearly when a signature asset download fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-updater-inputs-'))

  await assert.rejects(
    () => prepareUpdaterManifestInputs({
      repository: 'example/project',
      tagName: 'app-v1.2.3',
      outputDir: root,
      token: 'token',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases?')) {
          return jsonResponse([release('app-v1.2.3', [signatureAsset('DataPad++.app.tar.gz.sig')])])
        }
        return bytesResponse('Not found', 404)
      }
    }),
    /Downloading DataPad\+\+\.app\.tar\.gz\.sig failed with HTTP 404/
  )
})
