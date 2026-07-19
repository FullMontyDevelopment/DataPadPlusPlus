use super::super::*;

pub(super) fn generic_tree(family: &str) -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "objects",
            "Objects",
            &format!("{family}-objects"),
            &format!("{family} adapter objects"),
        ),
        node(
            "security",
            "Security",
            "security",
            "Roles, users, and permissions where supported",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Health and performance metadata where supported",
        ),
    ]
}
