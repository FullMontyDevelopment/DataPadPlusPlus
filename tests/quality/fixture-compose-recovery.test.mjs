import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fixtureStateNeedsRecreate,
  fixtureStateReason,
  shouldValidateFixtureCredentials,
} from '../fixtures/compose-recovery.mjs'

test('fixture recovery recreates the service that actually exited', () => {
  const mongodb = {
    Status: 'exited',
    ExitCode: 1,
    Health: { Status: 'unhealthy' },
  }
  const postgres = {
    Status: 'running',
    ExitCode: 0,
    Health: { Status: 'starting' },
  }

  assert.equal(fixtureStateNeedsRecreate(mongodb), true)
  assert.equal(fixtureStateNeedsRecreate(postgres), false)
  assert.equal(fixtureStateReason('mongodb', mongodb), 'mongodb exited with exit code 1')
})

test('fixture credential probes run only after a container is healthy', () => {
  assert.equal(shouldValidateFixtureCredentials({
    Status: 'running',
    Health: { Status: 'starting' },
  }), false)
  assert.equal(shouldValidateFixtureCredentials({
    Status: 'running',
    Health: { Status: 'healthy' },
  }), true)
  assert.equal(shouldValidateFixtureCredentials({
    Status: 'exited',
    Health: { Status: 'unhealthy' },
  }), false)
})

test('fixture recovery recognizes unhealthy and dead containers', () => {
  assert.equal(fixtureStateNeedsRecreate({
    Status: 'running',
    Health: { Status: 'unhealthy' },
  }), true)
  assert.equal(fixtureStateNeedsRecreate({ Status: 'dead' }), true)
  assert.equal(fixtureStateNeedsRecreate(undefined), false)
  assert.equal(
    fixtureStateReason('redis', { Status: 'running', Health: { Status: 'unhealthy' } }),
    'redis is unhealthy',
  )
})
