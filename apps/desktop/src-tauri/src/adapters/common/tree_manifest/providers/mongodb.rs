use super::super::*;

pub(super) fn mongo_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "databases",
            "Databases",
            "databases",
            "User MongoDB database namespaces",
        ),
        node(
            "system-databases",
            "System Databases",
            "system-databases",
            "admin, config, local",
        ),
    ]
}
