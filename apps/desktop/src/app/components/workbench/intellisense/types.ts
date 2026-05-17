import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  QueryTabState,
  ResultPayload,
  StructureResponse,
} from '@datapadplusplus/shared-types'

export type CompletionItemKind =
  | 'keyword'
  | 'schema'
  | 'table'
  | 'view'
  | 'collection'
  | 'index'
  | 'field'
  | 'command'
  | 'operator'
  | 'function'
  | 'snippet'
  | 'value'

export interface CompletionSchema {
  name: string
  detail?: string
}

export interface CompletionObject {
  name: string
  kind: string
  schema?: string
  path?: string[]
  detail?: string
}

export interface CompletionField {
  name: string
  dataType?: string
  objectName?: string
  schema?: string
  path?: string
  detail?: string
  primary?: boolean
}

export interface CompletionCommand {
  name: string
  detail?: string
}

export interface CompletionSnippet {
  label: string
  insertText: string
  detail?: string
}

export interface CompletionCatalog {
  connectionId?: string
  environmentId?: string
  engine?: ConnectionProfile['engine']
  family?: ConnectionProfile['family']
  schemas: CompletionSchema[]
  objects: CompletionObject[]
  fields: CompletionField[]
  commands: CompletionCommand[]
  operators: string[]
  functions: string[]
  snippets: CompletionSnippet[]
  loadedAt: string
  stale: boolean
  sources: string[]
}

export interface CompletionCatalogInput {
  connection?: ConnectionProfile
  environment?: EnvironmentProfile
  tab?: QueryTabState
  explorerNodes: ExplorerNode[]
  structure?: StructureResponse
  resultPayloads?: ResultPayload[]
}

export interface EditorCompletionContext {
  connection?: ConnectionProfile
  environment?: EnvironmentProfile
  tab?: QueryTabState
  language: string
  queryText: string
  cursorOffset?: number
  catalog: CompletionCatalog
}

export interface CompletionSuggestion {
  label: string
  insertText: string
  kind: CompletionItemKind
  detail?: string
  documentation?: string
  sortText?: string
}

export interface DatastoreCompletionProvider {
  id: string
  engines?: Array<ConnectionProfile['engine']>
  families?: Array<ConnectionProfile['family']>
  languages: string[]
  buildItems(context: EditorCompletionContext): CompletionSuggestion[]
}
