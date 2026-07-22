import { describe, expect, it } from 'vitest'
import type { DatastoreApiServerResourceConfig } from '@datapadplusplus/shared-types'
import { resourceGroup } from '../../../../src/app/components/workbench/ApiResourcePicker.helpers'

function resource(path?: string[]): DatastoreApiServerResourceConfig {
  return {
    id: 'orders',
    kind: 'table',
    label: 'Orders',
    nodeId: 'table:public:orders',
    path,
    endpointSlug: 'orders',
    enabled: true,
  }
}

describe('resourceGroup', () => {
  it('uses the Explorer parent path when the resource label is the final segment', () => {
    expect(resourceGroup(resource(['catalog', 'public', 'Tables', 'Orders'])))
      .toBe('catalog / public / Tables')
  })

  it('preserves category paths that already exclude the resource', () => {
    expect(resourceGroup(resource(['catalog', 'public', 'Tables'])))
      .toBe('catalog / public / Tables')
  })

  it('uses Other when no metadata path is available', () => {
    expect(resourceGroup(resource())).toBe('Other')
  })
})
