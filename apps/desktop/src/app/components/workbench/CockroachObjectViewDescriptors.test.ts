import { describe, expect, it } from 'vitest'
import {
  cockroachObjectViewMenuLabel,
  getCockroachObjectViewDescriptor,
  isCockroachObjectViewKind,
} from './CockroachObjectViewDescriptors'

describe('CockroachObjectViewDescriptors', () => {
  it('uses CockroachDB workflow-specific menu labels', () => {
    expect(cockroachObjectViewMenuLabel('cluster')).toBe('Open Cluster Overview')
    expect(cockroachObjectViewMenuLabel('ranges')).toBe('Review Ranges')
    expect(cockroachObjectViewMenuLabel('contention')).toBe('Review Contention')
    expect(cockroachObjectViewMenuLabel('cluster-settings')).toBe('Review Cluster Settings')
    expect(cockroachObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes supported object kinds', () => {
    expect(isCockroachObjectViewKind('cluster settings')).toBe(true)
    expect(isCockroachObjectViewKind('zone_configuration')).toBe(false)
    expect(isCockroachObjectViewKind('zone-configurations')).toBe(true)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getCockroachObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect CockroachDB Object')
    expect(descriptor.purpose).toContain('CockroachDB catalog')
  })
})
