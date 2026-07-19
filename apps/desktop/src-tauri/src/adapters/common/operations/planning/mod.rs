use std::collections::BTreeMap;

use serde_json::Value;

use crate::domain::models::{AdapterManifest, OperationPlan, ResolvedConnectionProfile};

mod providers;
mod support;

use support::*;

pub(crate) fn default_object_name(manifest: &AdapterManifest, provided: Option<&str>) -> String {
    provided
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| match manifest.family.as_str() {
            "document" => "<collection>".into(),
            "keyvalue" => "<key>".into(),
            "graph" => "<label>".into(),
            "timeseries" => "<measurement>".into(),
            "widecolumn" => "<table>".into(),
            "search" => "<index>".into(),
            "warehouse" | "embedded-olap" | "sql" => "<schema>.<table>".into(),
            _ => "<object>".into(),
        })
}

pub(crate) fn generated_operation_request(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    providers::generated_operation_request(
        connection,
        manifest,
        operation_id,
        object_name,
        parameters,
    )
}

pub(crate) fn default_operation_plan(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let object_name = default_object_name(manifest, object_name);
    let destructive = operation_id.contains(".drop")
        || operation_id.contains(".convert-to-capped")
        || operation_id.contains(".session.terminate")
        || operation_id.contains("backup-restore")
        || operation_id.contains(".backup.restore")
        || operation_id.contains(".key.delete")
        || operation_id.contains(".stream.delete")
        || operation_id.contains(".repair")
        || operation_id.contains(".flush");
    let admin_write = operation_id.contains(".create")
        || operation_id.contains(".update")
        || operation_id.contains(".hide")
        || operation_id.contains(".unhide")
        || operation_id.contains(".put-mapping")
        || operation_id.contains(".alias.")
        || operation_id.contains(".data-stream.rollover")
        || operation_id.contains(".pipeline.simulate")
        || operation_id.contains(".user.")
        || operation_id.contains(".role.")
        || operation_id.contains(".routine.execute")
        || operation_id.contains(".session.cancel")
        || operation_id.contains(".key.set")
        || operation_id.contains(".key.touch")
        || operation_id.contains(".key.increment")
        || operation_id.contains(".key.import")
        || operation_id.contains(".table.import")
        || operation_id.contains(".key.rename")
        || operation_id.contains(".key.copy")
        || operation_id.contains(".key.move")
        || operation_id.contains(".key.expire")
        || operation_id.contains(".key.persist")
        || operation_id.contains(".stream.ack")
        || operation_id.contains(".extension.")
        || operation_id.contains(".file.import")
        || operation_id.contains(".collection.import")
        || operation_id.contains(".collection.modify")
        || operation_id.contains(".collection.rename")
        || operation_id.contains(".event.")
        || (operation_id.contains(".security.") && !operation_id.ends_with("security.inspect"))
        || operation_id.contains("validation")
        || operation_id.contains("validator")
        || operation_id.contains("import-export")
        || operation_id.contains("backup-restore")
        || operation_id.contains(".backup.create")
        || operation_id.contains(".failover")
        || operation_id.contains(".checkpoint")
        || operation_id.contains(".vacuum")
        || operation_id.contains(".reindex")
        || operation_id.contains(".rebuild")
        || operation_id.contains(".reorganize")
        || operation_id.contains(".disable")
        || operation_id.contains(".enable")
        || operation_id.contains(".compact")
        || operation_id.contains(".reset")
        || operation_id.contains(".clone")
        || operation_id.contains(".copy")
        || operation_id.contains(".optimize")
        || operation_id.contains(".materialize")
        || operation_id.contains(".freeze")
        || operation_id.contains(".suspend")
        || operation_id.contains(".resume")
        || operation_id.contains(".repair")
        || operation_id.contains(".analyze");
    let costly = destructive
        || admin_write
        || operation_id.contains(".collection.export")
        || operation_id.contains(".collection.validate")
        || operation_id.contains(".key.export")
        || operation_id.contains(".table.export")
        || operation_id.contains(".database.backup")
        || operation_id.contains(".cardinality.")
        || operation_id.contains(".profile")
        || operation_id.contains("metrics");
    let generated_request =
        generated_operation_request(connection, manifest, operation_id, &object_name, parameters);
    let required_permissions = if destructive {
        vec!["owner/admin role or equivalent destructive privilege".into()]
    } else if admin_write {
        vec!["write/admin privilege for the target object".into()]
    } else {
        vec!["read metadata/query privilege".into()]
    };
    let mut warnings = Vec::new();

    if manifest.maturity == "beta" {
        warnings.push("This beta adapter returns a guarded operation plan before live mutation support is enabled.".into());
    }
    if connection.read_only {
        warnings.push("The selected connection profile is read-only; write, admin, and destructive execution will be blocked.".into());
    }
    if costly {
        warnings.push("This operation can execute workload, scan data, consume cloud resources, or affect cluster state.".into());
    }

    OperationPlan {
        operation_id: operation_id.into(),
        engine: manifest.engine.clone(),
        summary: format!("Prepared {} operation for {object_name}.", manifest.label),
        generated_request,
        request_language: manifest.default_language.clone(),
        destructive,
        estimated_cost: if costly {
            Some("Unknown until the live adapter runs an engine-specific dry run/profile.".into())
        } else {
            Some("No material cost expected for metadata/read preview.".into())
        },
        estimated_scan_impact: if operation_id.contains(".execute")
            || operation_id.contains(".profile")
            || operation_id.contains("metrics")
        {
            Some("Bound by the generated limit where possible; profile/analyze variants may execute the query.".into())
        } else {
            Some("Metadata-only or object-scoped.".into())
        },
        required_permissions,
        confirmation_text: if destructive || costly || admin_write || connection.read_only {
            Some(format!("CONFIRM {}", manifest.engine.to_uppercase()))
        } else {
            None
        },
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/common/operations/planning/mod_tests.rs"]
mod tests;
