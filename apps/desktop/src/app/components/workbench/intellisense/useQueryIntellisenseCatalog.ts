import { useMemo } from 'react'
import { buildCompletionCatalog } from './catalog'
import type { CompletionCatalog, CompletionCatalogInput } from './types'

const EMPTY_CATALOG: CompletionCatalog = {
  schemas: [],
  objects: [],
  fields: [],
  commands: [],
  operators: [],
  functions: [],
  snippets: [],
  loadedAt: '',
  stale: true,
  sources: [],
}

export function useQueryIntellisenseCatalog(input: CompletionCatalogInput) {
  const { connection, environment, explorerNodes, resultPayloads, structure, tab } = input

  return useMemo(() => {
    if (!connection || !environment) {
      return EMPTY_CATALOG
    }

    return buildCompletionCatalog({
      connection,
      environment,
      explorerNodes,
      resultPayloads,
      structure,
      tab,
    })
  }, [connection, environment, explorerNodes, resultPayloads, structure, tab])
}
