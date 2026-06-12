import test from 'node:test'
import assert from 'node:assert/strict'

import { validateUpdaterSigningEnv } from './validate-updater-signing-env.mjs'

function key(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

const validEnv = {
  DATAPADPLUSPLUS_UPDATER_PUBKEY: key('untrusted comment: minisign public key: 12345678\nRWQfakepublickey\n'),
  TAURI_SIGNING_PRIVATE_KEY: key('untrusted comment: rsign encrypted secret key\nRWQfakesecretkey\n'),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'correct horse battery staple'
}

test('accepts Tauri-shaped updater signing values', () => {
  assert.deepEqual(validateUpdaterSigningEnv(validEnv), {
    valid: true,
    errors: []
  })
})

test('rejects a password-looking public key value', () => {
  const result = validateUpdaterSigningEnv({
    ...validEnv,
    DATAPADPLUSPLUS_UPDATER_PUBKEY: '*lX2Wv)!RE8Un%>M_h)>w>l=k9d]vj'
  })

  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /DATAPADPLUSPLUS_UPDATER_PUBKEY must be the base64 text/)
})

test('rejects the public key pasted into the private key secret', () => {
  const result = validateUpdaterSigningEnv({
    ...validEnv,
    TAURI_SIGNING_PRIVATE_KEY: validEnv.DATAPADPLUSPLUS_UPDATER_PUBKEY
  })

  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /TAURI_SIGNING_PRIVATE_KEY must be the private key file content/)
})

test('rejects missing updater signing values', () => {
  const result = validateUpdaterSigningEnv({})

  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /DATAPADPLUSPLUS_UPDATER_PUBKEY is required/)
  assert.match(result.errors.join('\n'), /TAURI_SIGNING_PRIVATE_KEY is required/)
  assert.match(result.errors.join('\n'), /TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required/)
  assert.doesNotMatch(result.errors.join('\n'), /must be the base64 text/)
})
