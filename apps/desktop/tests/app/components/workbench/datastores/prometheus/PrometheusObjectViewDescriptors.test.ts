import { describe, expect, it } from 'vitest'
import {
  getPrometheusObjectViewDescriptor,
  isPrometheusObjectViewKind,
  prometheusObjectViewMenuLabel,
  PROMETHEUS_OBJECT_VIEW_KINDS,
} from '../../../../../../src/app/components/workbench/datastores/prometheus/PrometheusObjectViewDescriptors'

describe('PrometheusObjectViewDescriptors', () => {
  it('covers native Prometheus object-view kinds with specific labels', () => {
    expect(PROMETHEUS_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'metrics',
      'metric',
      'labels',
      'targets',
      'rules',
      'alerts',
      'service-discovery',
      'tsdb',
      'diagnostics',
    ]))

    expect(prometheusObjectViewMenuLabel('targets')).toBe('Review Targets')
    expect(prometheusObjectViewMenuLabel('rule_group')).toBe('Open Rule Group')
    expect(prometheusObjectViewMenuLabel('tsdb')).toBe('Open TSDB Status')
    expect(prometheusObjectViewMenuLabel('metric')).not.toBe('Open View')
  })

  it('normalizes kind names and falls back for unknown objects', () => {
    expect(isPrometheusObjectViewKind('service_discovery')).toBe(true)
    expect(isPrometheusObjectViewKind('remote write')).toBe(true)
    expect(isPrometheusObjectViewKind('unknown')).toBe(false)
    expect(getPrometheusObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect Prometheus Object',
      title: 'Prometheus Object',
    })
  })
})
