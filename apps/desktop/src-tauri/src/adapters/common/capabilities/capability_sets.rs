pub(crate) const SQL_PLANNED_CAPABILITIES: &[&str] = &[
    "supports_sql_editor",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_explain_plan",
    "supports_transactions",
    "supports_visual_query_builder",
    "supports_index_management",
    "supports_admin_operations",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_backup_restore",
    "supports_structure_visualization",
];

#[allow(dead_code)]
pub(crate) const DOCUMENT_CAPABILITIES: &[&str] = &[
    "supports_document_view",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_index_management",
    "supports_admin_operations",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_import_export",
    "supports_structure_visualization",
];

pub(crate) const CLOUD_DOCUMENT_CAPABILITIES: &[&str] = &[
    "supports_document_view",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_index_management",
    "supports_admin_operations",
    "supports_permission_inspection",
    "supports_cloud_iam",
    "supports_metrics_collection",
    "supports_cost_estimation",
    "supports_import_export",
];

pub(crate) const KEYVALUE_CAPABILITIES: &[&str] = &[
    "supports_key_browser",
    "supports_ttl_management",
    "supports_result_snapshots",
    "supports_admin_operations",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_structure_visualization",
];

pub(crate) const GRAPH_CAPABILITIES: &[&str] = &[
    "supports_graph_view",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_structure_visualization",
];

pub(crate) const CLOUD_GRAPH_CAPABILITIES: &[&str] = &[
    "supports_graph_view",
    "supports_result_snapshots",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_query_cancellation",
    "supports_cloud_iam",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_structure_visualization",
];

pub(crate) const TIMESERIES_CAPABILITIES: &[&str] = &[
    "supports_time_series_charting",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_streaming_results",
];

pub(crate) const TIMESERIES_SQL_CAPABILITIES: &[&str] = &[
    "supports_sql_editor",
    "supports_time_series_charting",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_structure_visualization",
];

pub(crate) const WIDECOLUMN_CAPABILITIES: &[&str] = &[
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_streaming_results",
    "supports_structure_visualization",
];

pub(crate) const SEARCH_CAPABILITIES: &[&str] = &[
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_cloud_iam",
    "supports_import_export",
    "supports_backup_restore",
    "supports_vector_search",
    "supports_structure_visualization",
];

pub(crate) const WAREHOUSE_CAPABILITIES: &[&str] = &[
    "supports_sql_editor",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_structure_visualization",
];

pub(crate) const CLOUD_WAREHOUSE_CAPABILITIES: &[&str] = &[
    "supports_sql_editor",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_user_role_browser",
    "supports_permission_inspection",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_cloud_iam",
    "supports_cost_estimation",
    "supports_import_export",
    "supports_structure_visualization",
];

pub(crate) const EMBEDDED_OLAP_CAPABILITIES: &[&str] = &[
    "supports_sql_editor",
    "supports_schema_browser",
    "supports_result_snapshots",
    "supports_local_database_creation",
    "supports_visual_query_builder",
    "supports_admin_operations",
    "supports_index_management",
    "supports_explain_plan",
    "supports_plan_visualization",
    "supports_query_profile",
    "supports_metrics_collection",
    "supports_import_export",
    "supports_backup_restore",
    "supports_structure_visualization",
];
