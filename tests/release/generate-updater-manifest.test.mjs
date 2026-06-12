import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  generateUpdaterManifest,
  generateUpdaterManifestFromFiles,
  REQUIRED_UPDATER_PLATFORMS
} from './generate-updater-manifest.mjs'

function asset(name) {
  return {
    name,
    browser_download_url: `https://example.test/releases/${encodeURIComponent(name)}`
  }
}

function signatureReader(signatures) {
  return (assetName) => signatures[assetName]
}

test('generates latest.json metadata for the v2 updater artifacts on every platform', () => {
  const release = {
    body: 'Release notes',
    created_at: '2026-06-12T08:00:00Z',
    assets: [
      asset('DataPad++_1.2.3_x64-setup.exe'),
      asset('DataPad++_1.2.3_x64_en-US.msi'),
      asset('DataPad++_1.2.3_amd64.AppImage'),
      asset('DataPad++.app.tar.gz')
    ]
  }

  const manifest = generateUpdaterManifest({
    release,
    version: '1.2.3',
    readSignature: signatureReader({
      'DataPad++_1.2.3_x64-setup.exe': 'windows-signature',
      'DataPad++_1.2.3_x64_en-US.msi': 'msi-signature',
      'DataPad++_1.2.3_amd64.AppImage': 'linux-signature',
      'DataPad++.app.tar.gz': 'mac-signature'
    })
  })

  assert.equal(manifest.version, '1.2.3')
  assert.equal(manifest.notes, 'Release notes')
  assert.deepEqual(Object.keys(manifest.platforms), REQUIRED_UPDATER_PLATFORMS.map((item) => item.key))
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'windows-signature')
  assert.match(manifest.platforms['windows-x86_64'].url, /setup\.exe$/)
  assert.equal(manifest.platforms['linux-x86_64'].signature, 'linux-signature')
  assert.match(manifest.platforms['linux-x86_64'].url, /\.AppImage$/)
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'mac-signature')
  assert.match(manifest.platforms['darwin-aarch64'].url, /\.app\.tar\.gz$/)
})

test('supports v1-compatible updater archives when present', () => {
  const manifest = generateUpdaterManifest({
    release: {
      assets: [
        asset('DataPad++_1.2.3_x64-setup.nsis.zip'),
        asset('DataPad++_1.2.3_amd64.AppImage.tar.gz'),
        asset('DataPad++.app.tar.gz')
      ]
    },
    version: '1.2.3',
    readSignature: signatureReader({
      'DataPad++_1.2.3_x64-setup.nsis.zip': 'windows-zip-signature',
      'DataPad++_1.2.3_amd64.AppImage.tar.gz': 'linux-tar-signature',
      'DataPad++.app.tar.gz': 'mac-signature'
    })
  })

  assert.equal(manifest.platforms['windows-x86_64'].signature, 'windows-zip-signature')
  assert.match(manifest.platforms['windows-x86_64'].url, /\.nsis\.zip$/)
  assert.equal(manifest.platforms['linux-x86_64'].signature, 'linux-tar-signature')
  assert.match(manifest.platforms['linux-x86_64'].url, /\.AppImage\.tar\.gz$/)
})

test('does not select unsigned installers or non-updater raw executable archives', () => {
  const manifest = generateUpdaterManifest({
    release: {
      assets: [
        asset('DataPadPlusPlus-1.2.3-windows-x64-executable.zip'),
        asset('DataPad++_1.2.3_x64-setup.exe'),
        asset('DataPad++_1.2.3_x64_en-US.msi'),
        asset('DataPad++_1.2.3_amd64.AppImage'),
        asset('DataPad++.app.tar.gz')
      ]
    },
    version: '1.2.3',
    readSignature: signatureReader({
      'DataPadPlusPlus-1.2.3-windows-x64-executable.zip': 'raw-exe-zip-signature',
      'DataPad++_1.2.3_x64_en-US.msi': 'msi-signature',
      'DataPad++_1.2.3_amd64.AppImage': 'linux-signature',
      'DataPad++.app.tar.gz': 'mac-signature'
    })
  })

  assert.equal(manifest.platforms['windows-x86_64'].signature, 'msi-signature')
  assert.match(manifest.platforms['windows-x86_64'].url, /\.msi$/)
})

test('fails when a required platform is missing a matching signature', () => {
  assert.throws(
    () => generateUpdaterManifest({
      release: {
        assets: [
          asset('DataPad++_1.2.3_x64-setup.exe'),
          asset('DataPad++_1.2.3_amd64.AppImage'),
          asset('DataPad++.app.tar.gz')
        ]
      },
      version: '1.2.3',
      readSignature: signatureReader({
        'DataPad++_1.2.3_x64-setup.exe': 'windows-signature',
        'DataPad++.app.tar.gz': 'mac-signature'
      })
    }),
    /linux-x86_64/
  )
})

test('can generate the manifest from release JSON and downloaded .sig files', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-updater-manifest-'))
  const releaseJsonPath = join(root, 'release.json')
  const outputPath = join(root, 'latest.json')
  const release = {
    assets: [
      asset('DataPad++_1.2.3_x64-setup.exe'),
      asset('DataPad++_1.2.3_amd64.AppImage'),
      asset('DataPad++.app.tar.gz')
    ]
  }

  writeFileSync(releaseJsonPath, JSON.stringify(release))
  writeFileSync(join(root, 'DataPad++_1.2.3_x64-setup.exe.sig'), 'windows-signature\n')
  writeFileSync(join(root, 'DataPad++_1.2.3_amd64.AppImage.sig'), 'linux-signature\n')
  writeFileSync(join(root, 'DataPad++.app.tar.gz.sig'), 'mac-signature\n')

  generateUpdaterManifestFromFiles({
    releaseJsonPath,
    signatureDir: root,
    version: '1.2.3',
    outputPath
  })

  const manifest = JSON.parse(readFileSync(outputPath, 'utf8'))
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'windows-signature')
  assert.equal(manifest.platforms['linux-x86_64'].signature, 'linux-signature')
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'mac-signature')
})
