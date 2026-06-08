use std::collections::HashSet;

use crate::{
    domain::{
        error::CommandError,
        models::{
            CancelTestRunRequest, ConnectionProfile, ConnectionTestRequest,
            CreateScopedQueryTabRequest, CreateTestSuiteTabRequest, EnvironmentProfile,
            ExecuteTestSuiteRequest, OpenTestSuiteTemplateRequest, QueryTabReorderRequest,
            ScopedQueryTarget, SecretRef, UpdateQueryBuilderStateRequest,
            UpdateTestSuiteTabRequest,
        },
    },
    security,
};

use super::common::*;

const MAX_TAGS: usize = 32;
const MAX_TAG_LENGTH: usize = 80;
const MAX_ENVIRONMENT_VARIABLES: usize = 256;
const MAX_TAB_REORDER_ITEMS: usize = 200;
const QUERY_VIEW_MODES: &[&str] = &["builder", "raw", "script"];
const ENVIRONMENT_RISKS: &[&str] = &["low", "medium", "high", "critical"];

pub(in crate::app::runtime) fn validate_connection_profile(
    profile: &ConnectionProfile,
) -> Result<(), CommandError> {
    validate_required_id(&profile.id, "Connection id")?;
    validate_required_text(&profile.name, "Connection name", MAX_OBJECT_NAME_LENGTH)?;
    validate_required_id(&profile.engine, "Datastore engine")?;
    validate_required_id(&profile.family, "Datastore family")?;
    validate_optional_text(Some(&profile.host), "Connection host", MAX_SCOPE_LENGTH)?;
    validate_optional_text(
        profile.database.as_deref(),
        "Connection database",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        profile.connection_mode.as_deref(),
        "Connection mode",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        profile.group.as_deref(),
        "Connection group",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        profile.notes.as_deref(),
        "Connection notes",
        MAX_SCOPE_LENGTH,
    )?;
    validate_optional_text(Some(&profile.icon), "Connection icon", 80)?;
    validate_optional_text(profile.color.as_deref(), "Connection color", 80)?;
    validate_profile_ids(&profile.environment_ids, "Connection environment id")?;
    validate_tags(&profile.tags)?;
    validate_connection_auth(&profile.auth)?;

    if let Some(connection_string) = profile.connection_string.as_deref() {
        validate_optional_text(
            Some(connection_string),
            "Connection string",
            MAX_SCOPE_LENGTH,
        )?;
        if security::connection_string_contains_secret(connection_string) {
            return Err(CommandError::new(
                "connection-string-secret",
                "Connection strings with embedded passwords, tokens, or keys are not saved. Put credentials in credential fields or environment secret variables.",
            ));
        }
    }

    Ok(())
}

pub(in crate::app::runtime) fn validate_connection_id(
    connection_id: &str,
) -> Result<(), CommandError> {
    validate_required_id(connection_id, "Connection id")
}

pub(in crate::app::runtime) fn validate_environment_id(
    environment_id: &str,
) -> Result<(), CommandError> {
    validate_required_id(environment_id, "Environment id")
}

pub(in crate::app::runtime) fn validate_connection_test_request(
    request: &ConnectionTestRequest,
) -> Result<(), CommandError> {
    validate_optional_id(
        (!request.environment_id.trim().is_empty()).then_some(request.environment_id.as_str()),
        "Environment id",
    )?;
    validate_connection_profile(&request.profile)?;
    if let Some(secret) = request.secret.as_deref() {
        validate_query_text(secret, "Connection secret")?;
    }
    Ok(())
}

pub(in crate::app::runtime) fn validate_environment_profile(
    profile: &EnvironmentProfile,
) -> Result<(), CommandError> {
    validate_required_id(&profile.id, "Environment id")?;
    validate_required_text(&profile.label, "Environment label", MAX_OBJECT_NAME_LENGTH)?;
    validate_optional_text(Some(&profile.color), "Environment color", 80)?;
    validate_optional_id(profile.inherits_from.as_deref(), "Parent environment id")?;
    if !ENVIRONMENT_RISKS.contains(&profile.risk.as_str()) {
        return Err(invalid_request(format!(
            "Unsupported environment risk: {}.",
            if profile.risk.is_empty() {
                "(empty)"
            } else {
                &profile.risk
            }
        )));
    }
    if profile.variable_definitions.len() > MAX_ENVIRONMENT_VARIABLES {
        return Err(invalid_request(format!(
            "Environments may include at most {MAX_ENVIRONMENT_VARIABLES} variables."
        )));
    }

    let mut seen = HashSet::new();
    for definition in &profile.variable_definitions {
        let key = normalize_variable_name(&definition.key);
        if !is_valid_variable_name(&key) {
            return Err(invalid_request(format!(
                "Environment variable name is invalid: {}.",
                if definition.key.is_empty() {
                    "(empty)"
                } else {
                    &definition.key
                }
            )));
        }
        if !seen.insert(key.clone()) {
            return Err(invalid_request(format!(
                "Environment variable is duplicated: {key}."
            )));
        }
        match definition.kind.as_str() {
            "secret" => {
                if definition
                    .value
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
                {
                    return Err(invalid_request(format!(
                        "Secret environment variable {key} cannot store plaintext values."
                    )));
                }
                if let Some(secret_ref) = &definition.secret_ref {
                    validate_secret_ref(secret_ref, &format!("Secret variable {key}"))?;
                }
            }
            "text" => validate_optional_text(
                definition.value.as_deref(),
                &format!("Environment variable {key}"),
                MAX_SCOPE_LENGTH,
            )?,
            other => {
                return Err(invalid_request(format!(
                    "Unsupported environment variable type for {key}: {other}."
                )))
            }
        }
    }

    Ok(())
}

pub(in crate::app::runtime) fn validate_create_scoped_query_tab_request(
    request: &CreateScopedQueryTabRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_optional_id(request.environment_id.as_deref(), "Environment id")?;
    validate_scoped_query_target(&request.target)
}

pub(in crate::app::runtime) fn validate_query_tab_reorder_request(
    request: &QueryTabReorderRequest,
) -> Result<(), CommandError> {
    if request.ordered_tab_ids.len() > MAX_TAB_REORDER_ITEMS {
        return Err(invalid_request(format!(
            "Tab reorder requests may include at most {MAX_TAB_REORDER_ITEMS} tabs."
        )));
    }
    let mut seen = HashSet::new();
    for tab_id in &request.ordered_tab_ids {
        validate_required_id(tab_id, "Tab id")?;
        if !seen.insert(tab_id) {
            return Err(invalid_request(format!(
                "Tab reorder request contains duplicate tab id: {tab_id}."
            )));
        }
    }
    Ok(())
}

pub(in crate::app::runtime) fn validate_update_query_tab_request(
    tab_id: &str,
    query_text: &str,
    query_view_mode: Option<&str>,
) -> Result<(), CommandError> {
    validate_required_id(tab_id, "Tab id")?;
    validate_query_text(query_text, "Query text")?;
    validate_query_view_mode(query_view_mode)
}

pub(in crate::app::runtime) fn validate_update_query_builder_state_request(
    request: &UpdateQueryBuilderStateRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    assert_json_size(&request.builder_state, "Query builder state")?;
    if let Some(query_text) = request.query_text.as_deref() {
        validate_query_text(query_text, "Query text")?;
    }
    validate_query_view_mode(request.query_view_mode.as_deref())
}

pub(in crate::app::runtime) fn validate_create_test_suite_tab_request(
    request: &CreateTestSuiteTabRequest,
) -> Result<(), CommandError> {
    validate_optional_id(request.connection_id.as_deref(), "Connection id")?;
    validate_optional_id(request.environment_id.as_deref(), "Environment id")?;
    validate_optional_text(
        request.template_id.as_deref(),
        "Test template id",
        MAX_ID_LENGTH,
    )?;
    assert_json_size(&request.suite, "Test suite definition")
}

pub(in crate::app::runtime) fn validate_open_test_suite_template_request(
    request: &OpenTestSuiteTemplateRequest,
) -> Result<(), CommandError> {
    validate_optional_id(request.connection_id.as_deref(), "Connection id")?;
    validate_optional_id(request.environment_id.as_deref(), "Environment id")?;
    validate_required_id(&request.template_id, "Test template id")
}

pub(in crate::app::runtime) fn validate_update_test_suite_tab_request(
    request: &UpdateTestSuiteTabRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    assert_json_size(&request.suite, "Test suite definition")?;
    if let Some(raw_text) = request.raw_text.as_deref() {
        validate_query_text(raw_text, "Test suite JSON")?;
    }
    Ok(())
}

pub(in crate::app::runtime) fn validate_execute_test_suite_request(
    request: &ExecuteTestSuiteRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    validate_optional_id(request.case_id.as_deref(), "Test case id")?;
    validate_optional_id(
        request.confirmed_guardrail_id.as_deref(),
        "Guardrail confirmation id",
    )
}

pub(in crate::app::runtime) fn validate_cancel_test_run_request(
    request: &CancelTestRunRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.run_id, "Test run id")?;
    validate_optional_id(request.tab_id.as_deref(), "Tab id")
}

fn validate_scoped_query_target(target: &ScopedQueryTarget) -> Result<(), CommandError> {
    validate_required_text(&target.kind, "Scoped query target kind", 80)?;
    validate_required_text(
        &target.label,
        "Scoped query target label",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_path(&target.path, "Scoped query target path")?;
    validate_optional_text(
        target.scope.as_deref(),
        "Scoped query target scope",
        MAX_SCOPE_LENGTH,
    )?;
    validate_optional_text(
        target.preferred_builder.as_deref(),
        "Scoped query target builder",
        80,
    )?;
    if let Some(template) = target.query_template.as_deref() {
        validate_query_text(template, "Scoped query template")?;
    }
    Ok(())
}

fn validate_query_view_mode(mode: Option<&str>) -> Result<(), CommandError> {
    if mode.is_some_and(|mode| !QUERY_VIEW_MODES.contains(&mode)) {
        return Err(invalid_request(format!(
            "Unsupported query view mode: {}.",
            mode.unwrap_or_default()
        )));
    }
    Ok(())
}

fn validate_connection_auth(
    auth: &crate::domain::models::ConnectionAuth,
) -> Result<(), CommandError> {
    validate_optional_text(
        auth.username.as_deref(),
        "Connection username",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        auth.auth_mechanism.as_deref(),
        "Connection auth mechanism",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(auth.ssl_mode.as_deref(), "Connection SSL mode", 80)?;
    validate_optional_text(
        auth.cloud_provider.as_deref(),
        "Connection cloud provider",
        80,
    )?;
    validate_optional_text(
        auth.principal.as_deref(),
        "Connection principal",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    if let Some(secret_ref) = &auth.secret_ref {
        validate_secret_ref(secret_ref, "Connection secret")?;
    }
    Ok(())
}

fn validate_secret_ref(secret_ref: &SecretRef, label: &str) -> Result<(), CommandError> {
    validate_required_id(&secret_ref.id, &format!("{label} id"))?;
    validate_required_text(&secret_ref.provider, &format!("{label} provider"), 80)?;
    validate_required_text(
        &secret_ref.service,
        &format!("{label} service"),
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_required_text(
        &secret_ref.account,
        &format!("{label} account"),
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_required_text(
        &secret_ref.label,
        &format!("{label} label"),
        MAX_OBJECT_NAME_LENGTH,
    )
}

fn validate_profile_ids(values: &[String], label: &str) -> Result<(), CommandError> {
    let mut seen = HashSet::new();
    for value in values {
        let id = value.trim();
        validate_required_id(id, label)?;
        if !seen.insert(id.to_string()) {
            return Err(invalid_request(format!("{label} is duplicated: {id}.")));
        }
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), CommandError> {
    if tags.len() > MAX_TAGS {
        return Err(invalid_request(format!(
            "Profiles may include at most {MAX_TAGS} tags."
        )));
    }
    for tag in tags {
        validate_optional_text(Some(tag.trim()), "Profile tag", MAX_TAG_LENGTH)?;
    }
    Ok(())
}

fn normalize_variable_name(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn is_valid_variable_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_uppercase() || first == '_')
        && chars.all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}
