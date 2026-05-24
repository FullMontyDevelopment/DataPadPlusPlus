import { describe, expect, it } from 'vitest'
import {
  getInfluxObjectViewDescriptor,
  influxObjectViewMenuLabel,
  INFLUX_OBJECT_VIEW_KINDS,
  isInfluxObjectViewKind,
} from './InfluxObjectViewDescriptors'

describe('InfluxObjectViewDescriptors', () => {
  it('covers native InfluxDB object-view kinds with specific labels', () => {
    expect(INFLUX_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'buckets',
      'bucket',
      'measurements',
      'measurement',
      'tags',
      'fields',
      'retention-policies',
      'tasks',
      'security',
      'diagnostics',
    ]))

    expect(influxObjectViewMenuLabel('measurement')).toBe('Open Measurement')
    expect(influxObjectViewMenuLabel('retention_policies')).toBe('Manage Retention')
    expect(influxObjectViewMenuLabel('security')).toBe('Review Tokens')
    expect(influxObjectViewMenuLabel('measurement')).not.toBe('Open View')
  })

  it('normalizes kind names and falls back for unknown objects', () => {
    expect(isInfluxObjectViewKind('retention policies')).toBe(true)
    expect(isInfluxObjectViewKind('field')).toBe(true)
    expect(isInfluxObjectViewKind('unknown')).toBe(false)
    expect(getInfluxObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect InfluxDB Object',
      title: 'InfluxDB Object',
    })
  })
})
