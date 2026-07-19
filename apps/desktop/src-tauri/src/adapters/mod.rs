use std::collections::BTreeMap;
pub(crate) use std::time::Instant;

use async_trait::async_trait;
use serde_json::Value;

use crate::domain::{
    error::CommandError,
    models::{
        AdapterDiagnostics, AdapterManifest, CancelExecutionRequest, CancelExecutionResult,
        ConnectionTestResult, DataEditChange, DataEditExecutionRequest, DataEditExecutionResponse,
        DataEditPlanRequest, DataEditPlanResponse, DatastoreDiagnosticsTab, DatastoreEditableScope,
        DatastoreExperienceAction, DatastoreExperienceBuilder, DatastoreExperienceManifest,
        DatastoreExperienceObjectKind, DatastoreOperationManifest, DocumentNodeChildrenRequest,
        DocumentNodeChildrenResponse, ExecutionCapabilities, ExecutionRequest,
        ExecutionResultEnvelope, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerNode,
        ExplorerRequest, ExplorerResponse, LocalDatabaseManifest, OperationExecutionRequest,
        OperationExecutionResponse, OperationPlan, PermissionInspection, QueryExecutionNotice,
        RedisKeyInspectRequest, RedisKeyScanRequest, RedisKeyScanResponse, RedisKeySummary,
        ResolvedConnectionProfile, ResultPageInfo, ResultPageRequest, ResultPageResponse,
        StructureEdge, StructureField, StructureGroup, StructureNode, StructureRequest,
        StructureResponse,
    },
};

mod common;
mod contract;
mod count_execution;
mod data_edit;
mod datastores;
mod experience;
mod registry;
mod runtime;

pub(crate) use common::*;
pub(crate) use contract::DatastoreAdapter;
pub(crate) use count_execution::{cancel_count_execution, register_count_execution};
pub(crate) use data_edit::{
    affected_rows_edit_executed, default_data_edit_execution, default_data_edit_plan,
};
pub(crate) use datastores::mongodb::cancel_mongodb_script_execution;
pub(crate) use experience::experience_manifest_for_manifest;
pub use registry::{execution_capabilities, manifests};
pub use runtime::{
    cancel, collect_diagnostics, execute, execute_data_edit, execute_operation,
    experience_manifests, fetch_document_node_children, fetch_result_page, inspect_explorer_node,
    inspect_permissions, inspect_redis_key, list_explorer_nodes, load_structure_map,
    operation_manifests, plan_data_edit, plan_operation, scan_redis_keys, test_connection,
};
