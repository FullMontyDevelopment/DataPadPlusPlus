export interface DocumentEditContext {
  connectionId: string
  environmentId: string
  queryText: string
  database?: string
  collection?: string
}
