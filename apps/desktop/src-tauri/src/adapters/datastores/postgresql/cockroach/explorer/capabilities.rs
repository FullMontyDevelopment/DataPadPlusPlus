use super::super::super::*;

pub(super) fn cockroach_capability(connection: &ResolvedConnectionProfile, key: &str) -> bool {
    let capabilities = connection
        .postgres_options
        .as_ref()
        .and_then(|options| options.cockroach_capabilities.as_ref());

    match key {
        "inspect_jobs" => capabilities
            .and_then(|item| item.inspect_jobs)
            .unwrap_or(true),
        "inspect_ranges" => capabilities
            .and_then(|item| item.inspect_ranges)
            .unwrap_or(true),
        "inspect_regions" => capabilities
            .and_then(|item| item.inspect_regions)
            .unwrap_or(true),
        "inspect_cluster_status" => capabilities
            .and_then(|item| item.inspect_cluster_status)
            .unwrap_or(true),
        "inspect_cluster_settings" => capabilities
            .and_then(|item| item.inspect_cluster_settings)
            .unwrap_or(true),
        "inspect_sessions" => capabilities
            .and_then(|item| item.inspect_sessions)
            .unwrap_or(true),
        "inspect_contention" => capabilities
            .and_then(|item| item.inspect_contention)
            .unwrap_or(true),
        "inspect_roles_and_grants" => capabilities
            .and_then(|item| item.inspect_roles_and_grants)
            .unwrap_or(true),
        "inspect_certificates" => capabilities
            .and_then(|item| item.inspect_certificates)
            .unwrap_or(true),
        "inspect_zone_configurations" => capabilities
            .and_then(|item| item.inspect_zone_configurations)
            .unwrap_or(true),
        "explain_analyze" => capabilities
            .and_then(|item| item.explain_analyze)
            .unwrap_or(true),
        _ => true,
    }
}
