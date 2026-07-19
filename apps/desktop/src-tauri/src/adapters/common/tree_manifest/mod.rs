use crate::domain::models::{DatastoreTreeManifest, DatastoreTreeNodeManifest};

mod providers;

pub(crate) fn datastore_tree_manifest(engine: &str, family: &str) -> DatastoreTreeManifest {
    DatastoreTreeManifest {
        version: 1,
        empty_state: "structural-folders".into(),
        roots: providers::tree_roots(engine, family),
    }
}

fn node(id: &str, label: &str, kind: &str, detail: &str) -> DatastoreTreeNodeManifest {
    node_with(id, label, kind, detail, Vec::new(), NodeOptions::default())
}

fn node_optional(id: &str, label: &str, kind: &str, detail: &str) -> DatastoreTreeNodeManifest {
    node_with(
        id,
        label,
        kind,
        detail,
        Vec::new(),
        NodeOptions::optional_when_live_metadata(),
    )
}

#[derive(Clone, Copy, Default)]
struct NodeOptions<'a> {
    requires_database: bool,
    hidden_when_database_selected: bool,
    optional_when_live_metadata: bool,
    default_database: Option<&'a str>,
}

impl<'a> NodeOptions<'a> {
    fn requires_database() -> Self {
        Self {
            requires_database: true,
            ..Self::default()
        }
    }

    fn hidden_when_database_selected() -> Self {
        Self {
            hidden_when_database_selected: true,
            ..Self::default()
        }
    }

    fn optional_when_live_metadata() -> Self {
        Self {
            optional_when_live_metadata: true,
            ..Self::default()
        }
    }

    fn default_database(default_database: &'a str) -> Self {
        Self {
            default_database: Some(default_database),
            ..Self::default()
        }
    }
}

fn node_with(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    children: Vec<DatastoreTreeNodeManifest>,
    options: NodeOptions<'_>,
) -> DatastoreTreeNodeManifest {
    DatastoreTreeNodeManifest {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        detail: Some(detail.into()),
        children,
        requires_database: options.requires_database,
        hidden_when_database_selected: options.hidden_when_database_selected,
        optional_when_live_metadata: options.optional_when_live_metadata,
        default_database: options.default_database.map(str::to_string),
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/common/tree_manifest/mod_tests.rs"]
mod tests;
