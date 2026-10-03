use super::*;
use mongodb::bson::{doc, Document};

pub(super) async fn validate_large_documents(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
) -> Result<(), CommandError> {
    let name = format!(
        "fixture_large_documents_{}",
        mongodb::bson::oid::ObjectId::new().to_hex()
    );
    let database = connection.database.as_deref().unwrap_or("catalog");
    let collection = client.database(database).collection::<Document>(&name);
    let verify = |condition: bool, message: &str| {
        if condition {
            Ok(())
        } else {
            Err(CommandError::new("fixture-assertion", message))
        }
    };
    let outcome: Result<(), CommandError> = async {
        // JSON escaping expands these 3 MiB into >18 MiB; BSON stores 3 MiB.
        let payload = "\u{1}".repeat(3 * 1024 * 1024);
        let value = json!({ "_id": "large-json-source", "payload": payload });
        verify(
            serde_json::to_vec(&value)?.len() > 16 * 1024 * 1024,
            "large source JSON",
        )?;
        let mut request = DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-fixture".into(),
            edit_kind: "insert-document".into(),
            target: DataEditTarget {
                object_kind: "document".into(),
                database: Some(database.into()),
                collection: Some(name.clone()),
                document_id: Some(json!("large-json-source")),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                value: Some(value.clone()),
                ..Default::default()
            }],
            confirmation_text: None,
        };
        verify(
            adapters::execute_data_edit(connection, &request)
                .await?
                .executed,
            "large JSON upload",
        )?;
        request.target.expected_document = Some(value.clone());
        request.edit_kind = "set-field".into();
        request.changes = vec![DataEditChange {
            path: Some(vec!["enabled".into()]),
            value: Some(json!(true)),
            ..Default::default()
        }];
        let edited = adapters::execute_data_edit(connection, &request).await?;
        verify(edited.executed, "edit with complete large baseline")?;
        let after = edited.metadata.as_ref().unwrap()["documentEvidence"]["afterDocument"].clone();
        verify(
            after["payload"] == value["payload"],
            "untouched large payload",
        )?;
        request.target.expected_document = Some(after.clone());
        let mut replacement = after;
        replacement["rawEdited"] = json!(true);
        request.edit_kind = "update-document".into();
        request.changes = vec![DataEditChange {
            value: Some(replacement),
            ..Default::default()
        }];
        verify(
            adapters::execute_data_edit(connection, &request)
                .await?
                .executed,
            "large JSON replacement",
        )?;
        verify(
            !adapters::execute_data_edit(connection, &request)
                .await?
                .executed,
            "stale large baseline rejected",
        )?;
        let stored = collection
            .find_one(doc! { "_id": "large-json-source" })
            .await?
            .unwrap();
        verify(
            stored.get_str("payload").ok() == Some(payload.as_str()),
            "stored value is complete",
        )?;
        verify(
            stored.get_bool("rawEdited").ok() == Some(true),
            "replacement persisted",
        )?;

        request.edit_kind = "insert-document".into();
        request.target.expected_document = None;
        request.changes[0].value =
            Some(json!({ "_id": "too-large", "payload": "x".repeat(16 * 1024 * 1024) }));
        let rejected = adapters::execute_data_edit(connection, &request).await;
        verify(
            rejected
                .err()
                .is_some_and(|error| error.code == "mongodb-document-too-large"),
            "native BSON limit enforced",
        )?;
        verify(
            collection.count_documents(doc! {}).await? == 1,
            "rejected insert wrote nothing",
        )?;

        // A realistic repeated baseline exercises plan redaction as well as
        // rename/unset execution. These are synthetic values, never credentials.
        let record = doc! {
            "password": "fixture-only-value", "token": "fixture-only-token",
            "passing": "untouched", "note": "Bearer fixture-only; Basic fixture-only;",
        };
        collection
            .insert_one(doc! {
                "_id": "repeated-baseline", "renameMe": "kept", "removeMe": "removed",
                "records": vec![record; 10_000],
            })
            .await?;
        let baseline = json!({
            "_id": "repeated-baseline", "renameMe": "kept", "removeMe": "removed",
            "records": vec![json!({
                "password": "fixture-only-value", "token": "fixture-only-token",
                "passing": "untouched", "note": "Bearer fixture-only; Basic fixture-only;",
            }); 10_000],
        });
        request.target.document_id = Some(json!("repeated-baseline"));
        request.target.expected_document = Some(baseline.clone());
        request.edit_kind = "rename-field".into();
        request.confirmation_text = Some("CONFIRM MONGODB RENAME-FIELD".into());
        request.changes = vec![DataEditChange {
            path: Some(vec!["renameMe".into()]),
            new_name: Some("renamed".into()),
            ..Default::default()
        }];
        let renamed = adapters::execute_data_edit(connection, &request).await?;
        verify(renamed.executed, "rename with repetitive baseline")?;
        let after = renamed.metadata.as_ref().unwrap()["documentEvidence"]["afterDocument"].clone();
        verify(
            after.get("renameMe").is_none() && after["renamed"] == "kept",
            "rename evidence",
        )?;
        verify(
            after["records"] == baseline["records"],
            "rename preserves unmasked data",
        )?;
        verify(
            !adapters::execute_data_edit(connection, &request)
                .await?
                .executed,
            "stale rename rejected",
        )?;

        request.target.expected_document = Some(after);
        request.edit_kind = "unset-field".into();
        request.confirmation_text = Some("CONFIRM MONGODB UNSET-FIELD".into());
        request.changes = vec![DataEditChange {
            path: Some(vec!["removeMe".into()]),
            ..Default::default()
        }];
        let removed = adapters::execute_data_edit(connection, &request).await?;
        verify(removed.executed, "remove with repetitive baseline")?;
        let after = &removed.metadata.as_ref().unwrap()["documentEvidence"]["afterDocument"];
        verify(
            after.get("removeMe").is_none() && after["renamed"] == "kept",
            "remove evidence",
        )?;
        verify(
            after["records"] == baseline["records"],
            "remove preserves unmasked data",
        )?;
        let stored = collection
            .find_one(doc! { "_id": "repeated-baseline" })
            .await?
            .unwrap();
        verify(
            !stored.contains_key("renameMe")
                && !stored.contains_key("removeMe")
                && stored.get_str("renamed").ok() == Some("kept"),
            "renamed and removed fields persisted",
        )?;
        Ok(())
    }
    .await;
    // Only this uniquely named fixture collection is removed, including on error.
    let cleanup = collection.drop().await;
    outcome?;
    cleanup?;
    Ok(())
}
