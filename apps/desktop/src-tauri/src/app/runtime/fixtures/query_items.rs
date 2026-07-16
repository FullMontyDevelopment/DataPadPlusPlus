use super::*;

pub(super) fn fixture_query_tab(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    environment_id: &str,
    created_at: &str,
) -> QueryTabState {
    QueryTabState {
        id: format!("tab-{}", seed.id),
        title: if environment_id == "env-local-demo" {
            screenshot_tab_title(connection, seed)
        } else {
            seed.query_title.into()
        },
        tab_kind: Some("query".into()),
        connection_id: connection.id.clone(),
        environment_id: environment_id.into(),
        family: connection.family.clone(),
        language: language_for_connection(connection),
        pinned: Some(seed.profile.is_none()),
        save_target: None,
        saved_query_id: Some(format!("saved-{}", seed.id)),
        editor_label: editor_label_for_connection(connection),
        query_text: seed.query_text.into(),
        query_view_mode: Some(crate::app::runtime::query_tabs::default_query_view_mode(
            connection,
        )),
        script_text: crate::app::runtime::query_tabs::default_script_text(connection),
        document_efficiency_mode: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: vec![QueryHistoryEntry {
            id: format!("history-{}", seed.id),
            query_text: seed.query_text.into(),
            executed_at: created_at.into(),
            status: "seeded".into(),
        }],
        error: None,
    }
}

pub(super) fn fixture_saved_query(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    environment_id: &str,
    created_at: &str,
) -> SavedWorkItem {
    SavedWorkItem {
        id: format!("saved-{}", seed.id),
        kind: "query".into(),
        name: if environment_id == "env-local-demo" {
            format!("{} overview", connection.name)
        } else {
            format!("{} smoke query", seed.name)
        },
        summary: if environment_id == "env-local-demo" {
            format!("Curated read-only overview for {}.", connection.name)
        } else {
            format!("Fixture query for {}", seed.name)
        },
        tags: if environment_id == "env-local-demo" {
            screenshot_tags_for_connection(connection)
        } else {
            seed.tags.iter().map(|tag| (*tag).to_string()).collect()
        },
        updated_at: created_at.into(),
        folder: Some(if environment_id == "env-local-demo" {
            screenshot_folder_for_connection(connection)
        } else {
            match seed.profile {
                Some(profile) => format!("Fixture Profiles/{profile}"),
                None => "Fixture Core".into(),
            }
        }),
        favorite: Some(seed.profile.is_none()),
        connection_id: Some(connection.id.clone()),
        environment_id: Some(environment_id.into()),
        language: Some(language_for_connection(connection)),
        query_text: Some(seed.query_text.into()),
        snapshot_result_id: None,
    }
}
