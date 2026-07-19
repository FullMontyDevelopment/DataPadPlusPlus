use super::super::*;

pub(super) fn search_operation_request(
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let object_path = search_path_segment(object_name);

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "explain": true,
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": numeric_parameter(parameters, "size").unwrap_or(20)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "profile": true,
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": numeric_parameter(parameters, "size").unwrap_or(20)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}"),
            "body": {
                "settings": parameters
                    .and_then(|values| values.get("settings"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "number_of_shards": 1, "number_of_replicas": 1 })),
                "mappings": parameters
                    .and_then(|values| values.get("mappings"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "properties": {} }))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.refresh") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_refresh")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.force-merge") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_forcemerge"),
            "body": {
                "max_num_segments": numeric_parameter(parameters, "maxNumSegments").unwrap_or(1),
                "only_expunge_deletes": bool_parameter(parameters, "onlyExpungeDeletes").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.clear-cache") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_cache/clear"),
            "body": {
                "query": bool_parameter(parameters, "queryCache").unwrap_or(true),
                "request": bool_parameter(parameters, "requestCache").unwrap_or(true),
                "fielddata": bool_parameter(parameters, "fielddataCache").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.reindex") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_reindex",
            "body": {
                "source": {
                    "index": object_name,
                    "query": { "match_all": {} }
                },
                "dest": {
                    "index": string_parameter(parameters, "destinationIndex")
                        .unwrap_or_else(|| format!("{object_name}-reindexed"))
                },
                "conflicts": string_parameter(parameters, "conflicts").unwrap_or_else(|| "proceed".into())
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.close") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_close")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.open") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_open")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.put-mapping") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}/_mapping"),
            "body": parameters
                .and_then(|values| values.get("mappings"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({
                    "properties": {
                        "new_field": { "type": "keyword" }
                    }
                }))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.update-settings") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}/_settings"),
            "body": parameters
                .and_then(|values| values.get("settings"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({
                    "index": {
                        "refresh_interval": "1s"
                    }
                }))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/{object_path}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.put") {
        let alias =
            string_parameter(parameters, "alias").unwrap_or_else(|| format!("{object_name}-read"));
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "add": { "index": object_name, "alias": alias } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.delete") {
        let alias = string_parameter(parameters, "alias").unwrap_or_else(|| object_name.into());
        let index = string_parameter(parameters, "index").unwrap_or_else(|| "*".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "remove": { "index": index, "alias": alias } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.explain") {
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/explain/{object_path}")
        } else {
            format!("/{object_path}/_ilm/explain")
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data-stream.rollover") {
        let conditions = parameters
            .and_then(|values| values.get("conditions"))
            .cloned()
            .unwrap_or_else(|| {
                serde_json::json!({
                    "max_age": "30d",
                    "max_primary_shard_size": "50gb"
                })
            });
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_rollover"),
            "body": {
                "conditions": conditions
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.create") {
        let template_name =
            string_parameter(parameters, "templateName").unwrap_or_else(|| object_name.into());
        let template_path = search_template_path(&template_name, parameters);
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": template_path,
            "body": {
                "index_patterns": parameters
                    .and_then(|values| values.get("indexPatterns"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([format!("{template_name}-*")])),
                "template": parameters
                    .and_then(|values| values.get("template"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({
                        "settings": { "number_of_shards": 1 },
                        "mappings": { "properties": {} }
                    })),
                "priority": numeric_parameter(parameters, "priority").unwrap_or(100)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.delete") {
        let template_name =
            string_parameter(parameters, "templateName").unwrap_or_else(|| object_name.into());
        let template_path = search_template_path(&template_name, parameters);
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": template_path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.put") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/_ingest/pipeline/{object_path}"),
            "body": {
                "description": string_parameter(parameters, "description")
                    .unwrap_or_else(|| "DataPad++ pipeline preview".into()),
                "processors": parameters
                    .and_then(|values| values.get("processors"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([
                        { "set": { "field": "processed_at", "value": "{{_ingest.timestamp}}" } }
                    ])),
                "on_failure": parameters
                    .and_then(|values| values.get("onFailure"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.simulate") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_ingest/pipeline/{object_path}/_simulate"),
            "body": {
                "docs": parameters
                    .and_then(|values| values.get("documents"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.put") {
        let policy_name =
            string_parameter(parameters, "policyName").unwrap_or_else(|| object_name.into());
        let policy_path = search_path_segment(&policy_name);
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/policies/{policy_path}")
        } else {
            format!("/_ilm/policy/{policy_path}")
        };
        let body = if let Some(policy) = parameters.and_then(|values| values.get("policy")) {
            policy.clone()
        } else if operation_id.starts_with("opensearch.") {
            serde_json::json!({ "policy": { "description": "DataPad++ preview policy", "states": [] } })
        } else {
            serde_json::json!({ "policy": { "phases": { "hot": { "actions": {} } } } })
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": path,
            "body": body
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("task.cancel") {
        let task_id = string_parameter(parameters, "taskId").unwrap_or_else(|| object_name.into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_tasks/{}/_cancel", search_path_segment(&task_id))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("snapshot.restore") {
        let repository =
            string_parameter(parameters, "repository").unwrap_or_else(|| "<repository>".into());
        let snapshot =
            string_parameter(parameters, "snapshot").unwrap_or_else(|| object_name.into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!(
                "/_snapshot/{}/{}/_restore",
                search_path_segment(&repository),
                search_path_segment(&snapshot)
            ),
            "body": {
                "indices": parameters
                    .and_then(|values| values.get("indices"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!("*")),
                "include_global_state": bool_parameter(parameters, "includeGlobalState").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        let path = if operation_id.starts_with("opensearch.") {
            "/_plugins/_security/api/roles"
        } else {
            "/_security/role"
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.slow-log") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Search.SlowLogDashboardPlan",
            "requests": [
                { "method": "GET", "path": "/_settings?filter_path=**.search.slowlog*" },
                { "method": "GET", "path": "/_nodes/stats/indices/search,indexing" },
                { "method": "GET", "path": format!("/{object_path}/_stats/search,indexing") }
            ],
            "executionGate": search_execution_gate("diagnostics.slow-log")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.allocation") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Search.AllocationExplainPlan",
            "requests": [
                { "method": "GET", "path": "/_cluster/allocation/explain" },
                { "method": "GET", "path": "/_cat/shards?format=json&bytes=b" },
                { "method": "GET", "path": "/_cluster/health?level=shards" }
            ],
            "executionGate": search_execution_gate("diagnostics.allocation")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": 1000,
                "sort": ["_doc"],
                "format": string_parameter(parameters, "format").unwrap_or_else(|| "ndjson".into())
            },
            "executionGate": search_execution_gate("import-export")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.backup-restore") {
        let repository =
            string_parameter(parameters, "repository").unwrap_or_else(|| "<repository>".into());
        let snapshot =
            string_parameter(parameters, "snapshot").unwrap_or_else(|| "<snapshot>".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!(
                "/_snapshot/{}/{}",
                search_path_segment(&repository),
                search_path_segment(&snapshot)
            ),
            "body": {
                "indices": object_name,
                "include_global_state": bool_parameter(parameters, "includeGlobalState").unwrap_or(false)
            },
            "executionGate": search_execution_gate("snapshot")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!(
        "{{\n  \"index\": \"{object_name}\",\n  \"body\": {{\n    \"query\": {{ \"match_all\": {{}} }},\n    \"size\": 100\n  }},\n  \"operation\": \"{operation_id}\",\n  \"parameters\": {parameter_json}\n}}"
    )
}

fn search_execution_gate(boundary: &str) -> Value {
    serde_json::json!({
        "defaultSupport": "plan-only",
        "evidence": "plan-only",
        "boundary": boundary,
        "runtimeEvidence": "contract",
        "disabledReasons": [
            "Search admin/import/export execution remains preview-first until permission, shard-impact, snapshot repository, and rollback boundaries are live-validated.",
            "Live search runtime currently supports plain HTTP endpoints with none/basic auth; HTTPS, cloud, token, API-key, and SigV4 profiles stay plan-only unless separately validated."
        ]
    })
}

fn search_template_path(
    template_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let object_kind = string_parameter(parameters, "objectKind").unwrap_or_default();
    let template_type = string_parameter(parameters, "templateType").unwrap_or_default();
    let prefix = if object_kind == "component-template" || template_type == "component" {
        "/_component_template"
    } else {
        "/_index_template"
    };
    let suffix = search_path_segment(template_name);

    format!("{prefix}/{suffix}")
}

fn search_path_segment(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with('<') && trimmed.ends_with('>') {
        return trimmed.into();
    }

    trimmed
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'*') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}
