use crate::domain::models::{AdapterManifest, ExecutionCapabilities};

use super::tree_manifest::datastore_tree_manifest;

pub(crate) const DEFAULT_PAGE_SIZE: u32 = 500;
pub(crate) const MAX_PAGE_SIZE: u32 = 5_000;

pub(crate) fn manifest(
    id: &str,
    engine: &str,
    family: &str,
    label: &str,
    default_language: &str,
    capabilities: &[&str],
) -> AdapterManifest {
    manifest_with_maturity(
        id,
        engine,
        family,
        label,
        "mvp",
        default_language,
        capabilities,
    )
}

pub(crate) fn manifest_with_maturity(
    id: &str,
    engine: &str,
    family: &str,
    label: &str,
    maturity: &str,
    default_language: &str,
    capabilities: &[&str],
) -> AdapterManifest {
    AdapterManifest {
        id: id.into(),
        engine: engine.into(),
        family: family.into(),
        label: label.into(),
        maturity: maturity.into(),
        capabilities: capabilities
            .iter()
            .map(|item| (*item).to_string())
            .collect(),
        default_language: default_language.into(),
        local_database: None,
        tree: Some(datastore_tree_manifest(engine, family)),
    }
}

mod capability_sets;

pub(crate) use capability_sets::*;

pub(crate) fn sql_capabilities(can_cancel: bool, can_explain: bool) -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel,
        can_explain,
        supports_live_metadata: true,
        editor_language: "sql".into(),
        default_row_limit: DEFAULT_PAGE_SIZE,
    }
}
