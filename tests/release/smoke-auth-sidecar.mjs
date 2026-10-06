import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { authContext } from './auth-sidecar-config.mjs'

const cacheDirectory = mkdtempSync(join(tmpdir(), 'datapad-auth-smoke-'))
const binaryArgument = process.argv.indexOf('--binary')
const binary = binaryArgument < 0 ? authContext().destination : process.argv[binaryArgument + 1]
if (!binary) throw new Error('The bundled helper path is required.')
const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
const errors = []
child.stderr.on('data', chunk => errors.push(chunk.toString()))
const timer = setTimeout(() => child.kill(), 20_000)
const request = async payload => { child.stdin.write(JSON.stringify(payload) + '\n'); const line = await lines.next(); assert.equal(line.done, false); return JSON.parse(line.value) }
const binding = { tenantId: '11111111-1111-1111-1111-111111111111', clientId: '22222222-2222-2222-2222-222222222222', binding: 'a'.repeat(64), cacheDirectory }
try {
  assert.deepEqual(await request({ operation: 'health' }), { protocolVersion: 1 })
  assert.deepEqual(await request({ operation: 'token', tenantId: 'SENSITIVE-MARKER' }), { error: 'invalid-configuration' })
  assert.equal((await request({ ...binding, operation: 'status' })).state, 'signed-out')
  assert.deepEqual(await request({ ...binding, operation: 'token' }), { error: 'sign-in-required' })
  assert.deepEqual(await request({ ...binding, binding: 'b'.repeat(64), operation: 'status' }), { error: 'binding-mismatch' })
  assert.equal((await request({ ...binding, operation: 'sign-out' })).state, 'signed-out')
  assert.deepEqual(readdirSync(cacheDirectory), [])
  const exited = once(child, 'exit'); child.stdin.end(); await exited
  assert.deepEqual(errors, [])
  console.log('Authentication helper: private protocol, binding isolation, silent sign-in refusal, session-only storage and sanitized errors passed. No identity network calls or browser sign-in performed.')
} finally {
  clearTimeout(timer); child.kill()
  rmSync(cacheDirectory, { recursive: true, force: true })
}
