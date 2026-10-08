use crate::domain::{
    error::CommandError,
    models::{ExplorerNode, ExplorerRequest, ResolvedConnectionProfile},
};

// Deliberately accept only a port, never a host or connection string: these
// mutation-backed metadata checks must stay on an isolated local fixture.
pub fn local_port(key: &str, fallback: u16) -> u16 {
    let generated = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/.generated.env"),
    )
    .unwrap_or_default();
    std::env::var(key)
        .ok()
        .or_else(|| {
            generated.lines().find_map(|line| {
                let (name, value) = line.split_once('=')?;
                (name == key).then(|| value.to_string())
            })
        })
        .map(|value| value.parse().expect("valid local fixture port"))
        .unwrap_or(fallback)
}

pub async fn read_all(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut request = ExplorerRequest {
        connection_id: connection.id.clone(),
        environment_id: "env-fixture".into(),
        scope: Some(scope.into()),
        limit: Some(37),
        cursor: None,
    };
    let mut nodes = Vec::new();
    let mut first_ids = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..20 {
        let page = crate::adapters::list_explorer_nodes(connection, &request).await?;
        let info = page.page_info.ok_or_else(|| {
            CommandError::new("fixture-paging", "Explorer did not return paging metadata.")
        })?;
        if page.nodes.len() > 37 || (info.has_more && page.nodes.is_empty()) {
            return Err(CommandError::new(
                "fixture-paging",
                "Invalid Explorer page boundary.",
            ));
        }
        if request.cursor.is_none() {
            first_ids = page.nodes.iter().map(|node| node.id.clone()).collect();
        }
        for node in page.nodes {
            if !seen.insert(node.id.clone()) {
                return Err(CommandError::new(
                    "fixture-paging",
                    "Duplicate Explorer node.",
                ));
            }
            nodes.push(node);
        }
        if !info.has_more {
            request.cursor = None;
            let refreshed = crate::adapters::list_explorer_nodes(connection, &request).await?;
            if refreshed
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>()
                != first_ids
            {
                return Err(CommandError::new(
                    "fixture-paging",
                    "Refresh did not reset to the first page.",
                ));
            }
            return Ok(nodes);
        }
        request.cursor = Some(info.next_cursor.ok_or_else(|| {
            CommandError::new("fixture-paging", "Explorer continuation is missing.")
        })?);
    }
    Err(CommandError::new(
        "fixture-paging",
        "Explorer did not finish paging.",
    ))
}
