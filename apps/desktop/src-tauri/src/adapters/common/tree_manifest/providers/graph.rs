use super::super::*;

pub(super) fn graph_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let root_label = if engine == "arango" {
        "Graphs"
    } else {
        "Databases"
    };
    let procedures_label = if engine == "neptune" {
        "Loader Jobs"
    } else if engine == "arango" {
        "Services"
    } else {
        "Procedures"
    };

    vec![
        node(
            "graphs",
            root_label,
            "graphs",
            &format!("{engine} graph scopes"),
        ),
        node(
            "node-labels",
            "Node Labels",
            "node-labels",
            "Node categories",
        ),
        node(
            "relationship-types",
            "Relationship Types",
            "relationship-types",
            "Edge categories",
        ),
        node(
            "property-keys",
            "Property Keys",
            "property-keys",
            "Property definitions",
        ),
        node("indexes", "Indexes", "indexes", "Graph indexes"),
        node(
            "constraints",
            "Constraints",
            "constraints",
            "Graph constraints",
        ),
        node(
            "procedures",
            procedures_label,
            "procedures",
            "Procedures, services, algorithms, or loader jobs",
        ),
        node(
            "security",
            "Security",
            "security",
            "Users, roles, and graph permissions",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Explain/profile and backend health",
        ),
    ]
}
