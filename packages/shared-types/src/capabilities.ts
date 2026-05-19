import type { DatastoreEngine, DatastoreFamily } from './connection'
import type { QueryLanguage } from './workspace'

export const ADAPTER_CAPABILITIES = [
  'supports_sql_editor',
  'supports_document_view',
  'supports_graph_view',
  'supports_time_series_charting',
  'supports_explain_plan',
  'supports_transactions',
  'supports_visual_query_builder',
  'supports_key_browser',
  'supports_schema_browser',
  'supports_ttl_management',
  'supports_result_snapshots',
  'supports_query_cancellation',
  'supports_streaming_results',
  'supports_local_database_creation',
  'supports_structure_visualization',
  'supports_admin_operations',
  'supports_index_management',
  'supports_user_role_browser',
  'supports_permission_inspection',
  'supports_plan_visualization',
  'supports_query_profile',
  'supports_metrics_collection',
  'supports_cloud_iam',
  'supports_cost_estimation',
  'supports_import_export',
  'supports_backup_restore',
  'supports_vector_search',
] as const

export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number]

export interface LocalDatabaseManifest {
  defaultExtension: string
  extensions: string[]
  canCreateEmpty: boolean
  canCreateStarter: boolean
}

export interface AdapterManifest {
  id: string
  engine: DatastoreEngine
  family: DatastoreFamily
  label: string
  maturity: 'mvp' | 'beta' | 'planned'
  capabilities: AdapterCapability[]
  defaultLanguage: QueryLanguage
  localDatabase?: LocalDatabaseManifest
  tree?: DatastoreTreeManifest
}

export interface DatastoreTreeManifest {
  version: 1
  emptyState: 'structural-folders'
  roots: DatastoreTreeNodeManifest[]
}

export interface DatastoreTreeNodeManifest {
  id: string
  label: string
  kind: string
  detail?: string
  children?: DatastoreTreeNodeManifest[]
  requiresDatabase?: boolean
  hiddenWhenDatabaseSelected?: boolean
  defaultDatabase?: string
  optionalWhenLiveMetadata?: boolean
}

export interface ExecutionCapabilities {
  canCancel: boolean
  canExplain: boolean
  supportsLiveMetadata: boolean
  editorLanguage: string
  defaultRowLimit: number
}
