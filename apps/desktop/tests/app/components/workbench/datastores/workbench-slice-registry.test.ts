import { describe, expect, it } from 'vitest'
import { DATASTORE_ENGINES } from '@datapadplusplus/shared-types'
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
      expect(workbenchSliceForEngine(engine)?.engine).toBe(engine)
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
      if (slice.objectViewWorkspace) {
        expect(typeof slice.objectViewWorkspace, `${slice.engine} object view workspace`).toBe('function')
      }

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
})
