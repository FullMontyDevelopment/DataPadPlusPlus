use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use mongodb::bson::{self, doc, Document};

use super::super::super::*;
use super::bson_extjson::mongodb_document_to_json;
use super::connection::{mongodb_client, mongodb_database_name};

const MONGODB_SCHEMA_SAMPLE_LIMIT: i64 = 50;

pub(crate) async fn load_mongodb_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(80);
    let client = mongodb_client(connection).await?;
    let database_name = mongodb_database_name(connection);
    let database = client.database(&database_name);
    let collections = database.list_collection_names().await?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut collection_names = Vec::new();
    for collection_name in collections.iter().take(limit as usize) {
        collection_names.push(collection_name.clone());
        let collection = database.collection::<Document>(collection_name);
        let index_names = collection.list_index_names().await.unwrap_or_default();
        let sample_documents = match collection
            .find(doc! {})
            .limit(MONGODB_SCHEMA_SAMPLE_LIMIT)
            .await
        {
            Ok(cursor) => cursor
                .try_collect::<Vec<Document>>()
                .await
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        let fields = mongodb_sample_fields(&sample_documents);
        let sample = sample_documents.first();
        let count = collection
            .estimated_document_count()
            .await
            .unwrap_or_default();
        nodes.push(StructureNode {
            id: collection_name.clone(),
            family: "document".into(),
            label: collection_name.clone(),
            kind: "collection".into(),
            group_id: Some(database_name.clone()),
            detail: Some(format!("{} index(es)", index_names.len())),
            database: Some(database_name.clone()),
            schema: Some(database_name.clone()),
            object_name: Some(collection_name.clone()),
            qualified_name: Some(format!("{database_name}.{collection_name}")),
            column_count: Some(fields.len() as u32),
            relationship_count: None,
            row_count_estimate: Some(count),
            index_count: Some(index_names.len() as u32),
            is_system: Some(false),
            is_view: Some(false),
            metrics: vec![
                structure_metric("Documents", count.to_string()),
                structure_metric("Indexes", index_names.len().to_string()),
            ],
            fields,
            sample: sample.map(mongodb_document_to_json),
        });
    }
    for node in &nodes {
        for field in &node.fields {
            if let Some(target) = inferred_mongo_target(&field.name, &collection_names) {
                edges.push(StructureEdge {
                    id: format!("{}:{}->{}", node.id, field.name, target),
                    from: node.id.clone(),
                    to: target.clone(),
                    label: format!("{} may reference {}", field.name, target),
                    kind: "inferred-reference".into(),
                    inferred: Some(true),
                    from_field: Some(field.name.clone()),
                    to_field: Some("_id".into()),
                    constraint_name: None,
                    cardinality: Some("many-to-one".into()),
                    delete_rule: None,
                    update_rule: None,
                    confidence: Some(0.7),
                });
            }
        }
    }

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} MongoDB collection(s).", nodes.len()),
            groups: vec![StructureGroup {
                id: database_name.clone(),
                label: database_name,
                kind: "database".into(),
                detail: Some("MongoDB database".into()),
                color: None,
            }],
            nodes,
            edges,
            metrics: vec![structure_metric(
                "Collections",
                nodes_count_hint(limit, collections.len()),
            )],
            truncated: collections.len() > limit as usize,
        },
    ))
}

#[derive(Default)]
struct MongoFieldSummary {
    data_type: Option<String>,
    present_count: usize,
    nullable: bool,
}

fn mongodb_sample_fields(documents: &[Document]) -> Vec<StructureField> {
    let total = documents.len();
    if total == 0 {
        return Vec::new();
    }
    let mut summaries = BTreeMap::<String, MongoFieldSummary>::new();
    for document in documents {
        for (name, value) in document {
            let summary = summaries.entry(name.clone()).or_default();
            summary.present_count += 1;
            if matches!(value, bson::Bson::Null) {
                summary.nullable = true;
            }
            summary.data_type = Some(merge_bson_type(
                summary.data_type.as_deref(),
                &bson_type_name(value),
            ));
        }
    }
    summaries
        .into_iter()
        .enumerate()
        .map(|(index, (name, summary))| {
            structure_field_with_flags(
                &name,
                summary.data_type.as_deref().unwrap_or("value"),
                None,
                Some(summary.nullable || summary.present_count < total),
                Some(name == "_id"),
                Some(index as u32),
                None,
            )
        })
        .collect()
}

fn merge_bson_type(existing: Option<&str>, next: &str) -> String {
    if next == "null" {
        return existing.unwrap_or("value").into();
    }
    let Some(existing) = existing else {
        return next.into();
    };
    if existing == next {
        return existing.into();
    }
    if matches!((existing, next), ("int32", "int64") | ("int64", "int32")) {
        return "int64".into();
    }
    if matches!(
        (existing, next),
        ("int32", "double") | ("int64", "double") | ("double", "int32") | ("double", "int64")
    ) {
        return "double".into();
    }
    "value".into()
}

fn bson_type_name(value: &bson::Bson) -> String {
    match value {
        bson::Bson::Double(_) => "double",
        bson::Bson::String(_) => "string",
        bson::Bson::Array(_) => "array",
        bson::Bson::Document(_) => "document",
        bson::Bson::Boolean(_) => "boolean",
        bson::Bson::Null => "null",
        bson::Bson::Int32(_) => "int32",
        bson::Bson::Int64(_) => "int64",
        bson::Bson::ObjectId(_) => "objectId",
        bson::Bson::DateTime(_) => "dateTime",
        _ => "value",
    }
    .into()
}

fn inferred_mongo_target(field_name: &str, collections: &[String]) -> Option<String> {
    let normalized = field_name
        .trim_end_matches("_id")
        .trim_end_matches("Id")
        .trim_end_matches("ID")
        .to_lowercase();

    collections.iter().find_map(|collection| {
        let singular = collection.trim_end_matches('s').to_lowercase();
        if normalized == singular || normalized == collection.to_lowercase() {
            Some(collection.clone())
        } else {
            None
        }
    })
}
