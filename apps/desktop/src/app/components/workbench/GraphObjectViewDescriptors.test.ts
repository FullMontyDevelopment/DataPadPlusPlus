import { describe, expect, it } from 'vitest'
import {
  getGraphObjectViewDescriptor,
  graphObjectViewMenuLabel,
  GRAPH_OBJECT_VIEW_KINDS,
  isGraphObjectViewKind,
} from './GraphObjectViewDescriptors'

describe('GraphObjectViewDescriptors', () => {
  it('covers native graph object-view kinds with specific labels', () => {
    expect(GRAPH_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'graphs',
      'graph',
      'node-labels',
      'node-label',
      'relationship-types',
      'relationship',
      'property-keys',
      'indexes',
      'constraints',
      'procedures',
      'security',
      'diagnostics',
    ]))

    expect(graphObjectViewMenuLabel('node label')).toBe('Open Node Label')
    expect(graphObjectViewMenuLabel('relationship-types')).toBe('Browse Relationship Types')
    expect(graphObjectViewMenuLabel('constraints')).toBe('Manage Constraints')
    expect(graphObjectViewMenuLabel('node-label')).not.toBe('Open View')
  })

  it('normalizes kind names and falls back for unknown objects', () => {
    expect(isGraphObjectViewKind('property_keys')).toBe(true)
    expect(isGraphObjectViewKind('node label')).toBe(true)
    expect(isGraphObjectViewKind('unknown')).toBe(false)
    expect(getGraphObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect Graph Object',
      title: 'Graph Object',
    })
  })
})
