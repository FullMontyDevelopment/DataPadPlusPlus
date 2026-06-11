import { describe, expect, it } from 'vitest'
import {
  getOpenTsdbObjectViewDescriptor,
  isOpenTsdbObjectViewKind,
  openTsdbObjectViewMenuLabel,
  OPENTSDB_OBJECT_VIEW_KINDS,
} from '../../../../../../src/app/components/workbench/datastores/opentsdb/OpenTsdbObjectViewDescriptors'

describe('OpenTsdbObjectViewDescriptors', () => {
  it('covers native OpenTSDB object-view kinds with specific labels', () => {
    expect(OPENTSDB_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'metrics',
      'metric',
      'tags',
      'aggregators',
      'downsampling',
      'uid-metadata',
      'trees',
      'stats',
      'diagnostics',
    ]))

    expect(openTsdbObjectViewMenuLabel('metric')).toBe('Open Metric')
    expect(openTsdbObjectViewMenuLabel('uid metadata')).toBe('Review UID Metadata')
    expect(openTsdbObjectViewMenuLabel('downsampling')).toBe('Review Downsampling')
    expect(openTsdbObjectViewMenuLabel('metric')).not.toBe('Open View')
  })

  it('normalizes kind names and falls back for unknown objects', () => {
    expect(isOpenTsdbObjectViewKind('uid_metadata')).toBe(true)
    expect(isOpenTsdbObjectViewKind('downsampler')).toBe(true)
    expect(isOpenTsdbObjectViewKind('unknown')).toBe(false)
    expect(getOpenTsdbObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect OpenTSDB Object',
      title: 'OpenTSDB Object',
    })
  })
})
