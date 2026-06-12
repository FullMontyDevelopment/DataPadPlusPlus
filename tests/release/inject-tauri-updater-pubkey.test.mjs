import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  injectTauriUpdaterPublicKey,
  normalizeTauriUpdaterPublicKey
} from './inject-tauri-updater-pubkey.mjs'

function publicKey(text = 'untrusted comment: minisign public key: 12345678\nRWQfakepublickey\n') {
  return Buffer.from(text, 'utf8').toString('base64')
}

test('injects the validated updater public key into Tauri config', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-tauri-config-'))
  const configPath = join(root, 'tauri.conf.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      plugins: {
        updater: {
          pubkey: '',
          endpoints: []
        }
      },
      bundle: {
        createUpdaterArtifacts: true
      }
    })
  )

  injectTauriUpdaterPublicKey(configPath, `\n${publicKey()}\n`)

  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(config.plugins.updater.pubkey, publicKey())
  assert.deepEqual(config.plugins.updater.endpoints, [])
})

test('creates the updater plugin config when it is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-tauri-config-'))
  const configPath = join(root, 'tauri.conf.json')
  writeFileSync(configPath, JSON.stringify({ productName: 'DataPad++' }))

  injectTauriUpdaterPublicKey(configPath, publicKey())

  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(config.plugins.updater.pubkey, publicKey())
  assert.deepEqual(config.plugins.updater.endpoints, [])
})

test('rejects decoded public key text because Tauri config expects the base64 wrapper', () => {
  assert.throws(
    () => normalizeTauriUpdaterPublicKey('untrusted comment: minisign public key: 12345678\nRWQfakepublickey\n'),
    /base64 text/
  )
})

test('rejects non-public-key base64 text', () => {
  assert.throws(
    () => normalizeTauriUpdaterPublicKey(Buffer.from('not a minisign key').toString('base64')),
    /\.key\.pub content/
  )
})
