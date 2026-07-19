import type { AdapterCapability } from '../capabilities'

export const SQL_CORE: AdapterCapability[] = [
  'supports_sql_editor',
  'supports_schema_browser',
  'supports_result_snapshots',
  'supports_import_export',
]

export const SQL_ADMIN: AdapterCapability[] = [
  'supports_admin_operations',
  'supports_index_management',
  'supports_user_role_browser',
  'supports_permission_inspection',
  'supports_explain_plan',
  'supports_plan_visualization',
  'supports_query_profile',
  'supports_metrics_collection',
]

export const CLOUD_SECURITY: AdapterCapability[] = [
  'supports_cloud_iam',
  'supports_permission_inspection',
]

export const tableSchemaPlan = ['table', 'schema', 'json', 'plan', 'profile', 'metrics'] as const
export const documentRenderers = ['document', 'json', 'table', 'schema', 'plan', 'profile'] as const
export const graphRenderers = ['graph', 'table', 'json', 'plan', 'profile'] as const
export const seriesRenderers = ['series', 'chart', 'table', 'metrics', 'json'] as const
export const keyValueRenderers = ['keyvalue', 'table', 'json', 'raw', 'metrics'] as const
