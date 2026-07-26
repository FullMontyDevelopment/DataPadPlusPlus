import { describe, expect, it } from 'vitest'
import { DATASTORE_ENGINES } from '@datapadplusplus/shared-types'
import type { DatastoreTreeNodeManifest } from '@datapadplusplus/shared-types'
import {
  workbenchSliceForEngine,
  workbenchSlices,
} from '../../../../../src/app/components/workbench/datastores/registry'

describe('datastore workbench slice registry', () => {
  it('registers exactly one workbench slice for every declared datastore engine', () => {
    const registeredEngines = workbenchSlices.map((slice) => slice.engine)

    expect(new Set(registeredEngines).size).toBe(registeredEngines.length)
    expect([...registeredEngines].sort()).toEqual([...DATASTORE_ENGINES].sort())

    for (const engine of DATASTORE_ENGINES) {
      expect(workbenchSliceForEngine(engine).engine).toBe(engine)
    }
  })

  it('keeps every workbench slice wired to at least one workbench hook', () => {
    for (const slice of workbenchSlices) {
      const hookKeys = Object.keys(slice).filter((key) => key !== 'engine')

      expect(hookKeys, `${slice.engine} workbench slice should expose a workbench hook`).not.toEqual([])
    }
  })

  it('keeps registered workbench hooks callable through their public slice contracts', () => {
    for (const slice of workbenchSlices) {
      expect(slice.explorer.engine).toBe(slice.engine)
      expect(slice.objectView.engine).toBe(slice.engine)
      expect(typeof slice.explorer.Navigator, `${slice.engine} Explorer navigator`).toBe('function')
      expect(typeof slice.explorer.Workspace, `${slice.engine} Explorer workspace`).toBe('function')
      expect(typeof slice.objectView.Workspace, `${slice.engine} object view workspace`).toBe('function')
      expect(slice.explorer.detailProviders.length, `${slice.engine} Explorer details`).toBeGreaterThan(0)
      const providerKinds = slice.explorer.detailProviders.map((provider) => provider.kind)
      expect(new Set(providerKinds).size, `${slice.engine} unique Explorer detail providers`).toBe(providerKinds.length)
      expect(
        [...treeKinds(slice.explorer.tree.roots)].every((kind) => providerKinds.includes(kind)),
        `${slice.engine} declared Explorer node kinds`,
      ).toBe(true)

      if (slice.relationalDescriptor) {
        expect(() => slice.relationalDescriptor?.('table')).not.toThrow()
      }

      if (slice.relationalInsights) {
        expect(() => slice.relationalInsights?.({
          kind: 'table',
          payload: {},
        })).not.toThrow()
      }

      if (slice.warehouseInsights) {
        expect(() => slice.warehouseInsights?.({
          kind: 'table',
          payload: {},
        })).not.toThrow()
      }
    }
  })

  it('registers live leaf inspection policies instead of relying on an unknown-node fallback', () => {
    expect(
      workbenchSliceForEngine('postgresql').explorer.detailProviderForNode({
        id: 'table:public.accounts',
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        scope: 'table:public.accounts',
        expandable: true,
      }).mode,
    ).toBe('inspection')
    expect(
      workbenchSliceForEngine('redis').explorer.detailProviderForNode({
        id: 'string:session:42',
        family: 'keyvalue',
        label: 'session:42',
        kind: 'string',
      }).mode,
    ).toBe('inspection')
    expect(
      workbenchSliceForEngine('neo4j').explorer.detailProviderForNode({
        id: 'node-label:Customer',
        family: 'graph',
        label: 'Customer',
        kind: 'node-label',
      }).mode,
    ).toBe('inspection')
    expect(
      workbenchSliceForEngine('postgresql').explorer.detailProviderForNode({
        id: 'future-node',
        family: 'sql',
        label: 'Future node',
        kind: 'future-node-kind',
      }).mode,
    ).toBe('state')
  })

  it('owns query-mode policy in datastore workbench slices', () => {
    const mongodb = workbenchSliceForEngine('mongodb')
    const oracle = workbenchSliceForEngine('oracle')

    expect(mongodb.query).toMatchObject({
      supportsScripting: true,
      supportsDocumentEfficiency: true,
      supportsAddDocument: true,
    })
    expect(mongodb.query?.requiresStructureRefresh?.({} as never)).toBe(true)
    expect(typeof oracle.query?.requiresStructureRefresh).toBe('function')
  })
})

function treeKinds(nodes: readonly DatastoreTreeNodeManifest[]) {
  const kinds = new Set<string>()
  const visit = (node: DatastoreTreeNodeManifest) => {
    kinds.add(node.kind)
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return kinds
}
