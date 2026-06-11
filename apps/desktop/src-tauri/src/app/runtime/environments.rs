use std::collections::HashMap;

use super::timestamp_now;
use crate::domain::models::{
    EnvironmentProfile, EnvironmentVariableDefinition, ResolvedConnectionProfile,
    ResolvedEnvironment, SecretRef,
};
use crate::{domain::error::CommandError, security};

pub(super) fn interpolate_value(value: &str, variables: &HashMap<String, String>) -> String {
    variables
        .iter()
        .fold(value.to_string(), |current, (key, resolved)| {
            current
                .replace(&format!("{{{{{key}}}}}"), resolved)
                .replace(&format!("${{{key}}}"), resolved)
        })
}

pub(super) fn build_resolution_warnings(
    profile: &ResolvedConnectionProfile,
    resolved_environment: &ResolvedEnvironment,
) -> Vec<String> {
    let mut warnings = Vec::new();

    if !resolved_environment.unresolved_keys.is_empty() {
        warnings.push("Some environment variables are unresolved.".into());
    }

    if has_unresolved_tokens(&profile.host)
        || profile
            .database
            .as_ref()
            .is_some_and(|value| has_unresolved_tokens(value))
        || profile
            .connection_string
            .as_ref()
            .is_some_and(|value| has_unresolved_tokens(value))
    {
        warnings.push("Connection fields still contain unresolved placeholders.".into());
    }

    warnings
}

pub(super) fn has_unresolved_tokens(value: &str) -> bool {
    value.contains("{{") || value.contains("${")
}

pub(super) fn legacy_to_brace_tokens(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while let Some(relative_start) = value[cursor..].find("${") {
        let start = cursor + relative_start;
        output.push_str(&value[cursor..start]);
        let key_start = start + 2;
        let Some(relative_end) = value[key_start..].find('}') else {
            output.push_str(&value[start..]);
            return output;
        };
        let key_end = key_start + relative_end;
        let key = &value[key_start..key_end];

        if is_valid_variable_key(key) {
            output.push_str("{{");
            output.push_str(key);
            output.push_str("}}");
        } else {
            output.push_str(&value[start..=key_end]);
        }

        cursor = key_end + 1;
    }

    output.push_str(&value[cursor..]);
    output
}

pub(super) fn is_valid_variable_key(key: &str) -> bool {
    let mut characters = key.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    (first.is_ascii_uppercase() || first == '_')
        && characters.all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}

pub(super) fn secret_ref_for_environment_variable(environment_id: &str, key: &str) -> SecretRef {
    SecretRef {
        id: format!("secret-env-{environment_id}-{key}"),
        provider: "os-keyring".into(),
        service: "DataPad++".into(),
        account: format!("environment:{environment_id}:{key}"),
        label: format!("Environment {environment_id} variable {key}"),
    }
}

pub(super) fn normalize_environment_profile(profile: &mut EnvironmentProfile) {
    let timestamp = timestamp_now();
    let mut definitions = environment_variable_definitions(profile);
    let mut normalized_variables = HashMap::new();
    let mut sensitive_keys = Vec::new();

    for definition in &mut definitions {
        definition.key = definition.key.trim().to_ascii_uppercase();

        if definition.kind == "secret" {
            if definition.secret_ref.is_none() {
                definition.secret_ref = Some(secret_ref_for_environment_variable(
                    &profile.id,
                    &definition.key,
                ));
            }
            definition.value = None;
            if !sensitive_keys.contains(&definition.key) {
                sensitive_keys.push(definition.key.clone());
            }
        } else {
            definition.kind = "text".into();
            let value = legacy_to_brace_tokens(definition.value.as_deref().unwrap_or_default());
            definition.value = Some(value.clone());
            normalized_variables.insert(definition.key.clone(), value);
        }

        definition
            .updated_at
            .get_or_insert_with(|| timestamp.clone());
    }

    profile.variables = normalized_variables;
    profile.sensitive_keys = sensitive_keys;
    profile.variable_definitions = definitions
        .into_iter()
        .filter(|definition| is_valid_variable_key(&definition.key))
        .collect();
}

pub(super) fn migrate_environment_profile_secrets(profile: &mut EnvironmentProfile) {
    let mut definitions = Vec::new();
    let timestamp = timestamp_now();
    let sensitive_keys = profile
        .sensitive_keys
        .iter()
        .map(|key| key.to_ascii_uppercase())
        .collect::<Vec<_>>();

    for (key, value) in profile.variables.clone() {
        let normalized_key = key.trim().to_ascii_uppercase();
        if !is_valid_variable_key(&normalized_key) {
            continue;
        }

        if sensitive_keys.contains(&normalized_key) {
            let secret_ref = secret_ref_for_environment_variable(&profile.id, &normalized_key);
            if !value.trim().is_empty() && value != "********" {
                let _ = security::store_secret_value(&secret_ref, &value);
            }
            definitions.push(EnvironmentVariableDefinition {
                key: normalized_key,
                kind: "secret".into(),
                value: None,
                secret_ref: Some(secret_ref),
                updated_at: Some(timestamp.clone()),
            });
        } else {
            definitions.push(EnvironmentVariableDefinition {
                key: normalized_key,
                kind: "text".into(),
                value: Some(legacy_to_brace_tokens(&value)),
                secret_ref: None,
                updated_at: Some(timestamp.clone()),
            });
        }
    }

    if !profile.variable_definitions.is_empty() {
        definitions.extend(profile.variable_definitions.clone());
    }

    profile.variable_definitions = definitions;
    normalize_environment_profile(profile);
}

fn environment_variable_definitions(
    environment: &EnvironmentProfile,
) -> Vec<EnvironmentVariableDefinition> {
    let mut definitions = Vec::new();

    for definition in &environment.variable_definitions {
        if is_valid_variable_key(&definition.key.trim().to_ascii_uppercase()) {
            definitions.push(definition.clone());
        }
    }

    for (key, value) in &environment.variables {
        let normalized_key = key.trim().to_ascii_uppercase();
        if !is_valid_variable_key(&normalized_key)
            || definitions.iter().any(|item| item.key == normalized_key)
        {
            continue;
        }

        let secret = environment
            .sensitive_keys
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&normalized_key));
        definitions.push(EnvironmentVariableDefinition {
            key: normalized_key.clone(),
            kind: if secret { "secret" } else { "text" }.into(),
            value: if secret { None } else { Some(value.clone()) },
            secret_ref: if secret {
                Some(secret_ref_for_environment_variable(
                    &environment.id,
                    &normalized_key,
                ))
            } else {
                None
            },
            updated_at: None,
        });
    }

    definitions
}

fn resolve_environment_variables(
    resolved_chain: &[EnvironmentProfile],
    resolve_secrets: bool,
) -> (
    HashMap<String, String>,
    Vec<String>,
    Vec<String>,
    Vec<EnvironmentVariableDefinition>,
) {
    let mut variables = HashMap::new();
    let mut unresolved_keys = Vec::new();
    let mut sensitive_keys = Vec::new();
    let mut definitions = Vec::new();

    for environment in resolved_chain {
        for definition in environment_variable_definitions(environment) {
            let key = definition.key.trim().to_ascii_uppercase();

            if !is_valid_variable_key(&key) {
                continue;
            }

            if definition.kind == "secret" {
                if !sensitive_keys.contains(&key) {
                    sensitive_keys.push(key.clone());
                }

                let resolved = if resolve_secrets {
                    definition
                        .secret_ref
                        .as_ref()
                        .and_then(|secret_ref| security::resolve_secret_value(secret_ref).ok())
                } else {
                    definition
                        .secret_ref
                        .as_ref()
                        .map(|_| "********".to_string())
                };

                match resolved {
                    Some(value) if !value.is_empty() => {
                        variables.insert(key.clone(), value);
                    }
                    _ => {
                        variables.insert(key.clone(), "********".into());
                        if !unresolved_keys.contains(&key) {
                            unresolved_keys.push(key.clone());
                        }
                    }
                }

                definitions.retain(|item: &EnvironmentVariableDefinition| item.key != key);
                definitions.push(EnvironmentVariableDefinition {
                    key,
                    kind: "secret".into(),
                    value: None,
                    secret_ref: definition.secret_ref,
                    updated_at: definition.updated_at,
                });
                continue;
            }

            let value = legacy_to_brace_tokens(definition.value.as_deref().unwrap_or_default());
            if has_unresolved_tokens(&interpolate_value(&value, &variables))
                && !unresolved_keys.contains(&key)
            {
                unresolved_keys.push(key.clone());
            }
            variables.insert(key.clone(), interpolate_value(&value, &variables));
            definitions.retain(|item: &EnvironmentVariableDefinition| item.key != key);
            definitions.push(EnvironmentVariableDefinition {
                key,
                kind: "text".into(),
                value: Some(value),
                secret_ref: None,
                updated_at: definition.updated_at,
            });
        }
    }

    (variables, unresolved_keys, sensitive_keys, definitions)
}

pub(super) fn resolve_environment_for_execution(
    environments: &[EnvironmentProfile],
    environment_id: &str,
) -> ResolvedEnvironment {
    resolve_environment_internal(environments, environment_id, true)
}

pub fn resolve_environment(
    environments: &[EnvironmentProfile],
    environment_id: &str,
) -> ResolvedEnvironment {
    resolve_environment_internal(environments, environment_id, false)
}

fn resolve_environment_internal(
    environments: &[EnvironmentProfile],
    environment_id: &str,
    resolve_secrets: bool,
) -> ResolvedEnvironment {
    if environment_id.trim().is_empty() {
        return ResolvedEnvironment {
            environment_id: String::new(),
            label: "No environment".into(),
            risk: "low".into(),
            variables: HashMap::new(),
            unresolved_keys: Vec::new(),
            inherited_chain: Vec::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
        };
    }
    let fallback = environments
        .first()
        .cloned()
        .unwrap_or_else(|| EnvironmentProfile {
            id: "environment-missing".into(),
            label: "Missing environment".into(),
            color: "#000000".into(),
            risk: "low".into(),
            inherits_from: None,
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: timestamp_now(),
            updated_at: timestamp_now(),
        });
    let environment_map: HashMap<String, EnvironmentProfile> = environments
        .iter()
        .cloned()
        .map(|environment| (environment.id.clone(), environment))
        .collect();
    let mut resolved_chain = Vec::new();
    let mut visited = Vec::new();
    let mut current = environment_map.get(environment_id).cloned();

    while let Some(environment) = current {
        if visited.iter().any(|item| item == &environment.id) {
            break;
        }

        visited.push(environment.id.clone());
        current = environment
            .inherits_from
            .as_ref()
            .and_then(|parent| environment_map.get(parent))
            .cloned();
        resolved_chain.insert(0, environment);
    }

    let active_environment = environment_map
        .get(environment_id)
        .cloned()
        .unwrap_or(fallback);

    let mut inherited_chain = Vec::new();

    for environment in &resolved_chain {
        inherited_chain.push(environment.label.clone());
    }

    let (variables, unresolved_keys, sensitive_keys, variable_definitions) =
        resolve_environment_variables(&resolved_chain, resolve_secrets);

    ResolvedEnvironment {
        environment_id: active_environment.id,
        label: active_environment.label,
        risk: active_environment.risk,
        variables,
        unresolved_keys,
        inherited_chain,
        sensitive_keys,
        variable_definitions,
    }
}

pub(super) fn resolve_string_template(
    value: &str,
    variables: &HashMap<String, String>,
) -> Result<String, CommandError> {
    let migrated = legacy_to_brace_tokens(value);
    let resolved = interpolate_value(&migrated, variables);

    if has_unresolved_tokens(&resolved) {
        return Err(CommandError::new(
            "environment-variable-unresolved",
            "Unresolved environment variables must be fixed before this command can run.",
        ));
    }

    Ok(resolved)
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/environments_tests.rs"]
mod tests;
