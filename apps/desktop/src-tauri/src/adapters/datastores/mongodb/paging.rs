use futures_util::TryStreamExt;
use mongodb::bson::{doc, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::bson_extjson::mongodb_json_to_document;
use super::connection::{mongodb_client, mongodb_database_name_for_collection_query};
use super::document_lazy::{can_use_efficiency_mode, mongodb_document_payload};

pub(crate) async fn fetch_mongodb_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let page_size = bounded_page_size(request.page_size);
    let page_index = request.page_index.unwrap_or(1);
    let client = mongodb_client(connection).await?;
    let input = serde_json::from_str::<serde_json::Value>(selected_page_query(request))?;
    let collection_name = input
        .get("collection")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "mongodb-query-shape",
                "MongoDB queries must include a `collection` field for paging.",
            )
        })?;
    let database_resolution =
        mongodb_database_name_for_collection_query(&client, connection, &input, collection_name)
            .await?;
    let page_notices = database_resolution
        .notice
        .map(|notice| notice.message)
        .into_iter()
        .collect();
    let database = client.database(&database_resolution.database_name);
    let collection = database.collection::<Document>(collection_name);
    let query_skip = input.get("skip").and_then(Value::as_u64).unwrap_or(0);
    let skip = query_skip + u64::from(page_index) * u64::from(page_size);
    let explicit_limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0);
    let effective_page_size = explicit_limit
        .map(|limit| limit.min(page_size))
        .unwrap_or(page_size);
    let documents = if let Some(pipeline) = input.get("pipeline").and_then(Value::as_array) {
        let mut pipeline = pipeline
            .iter()
            .map(|stage| mongodb_json_to_document(stage, "pipeline[]", "mongodb-paging-bson"))
            .collect::<Result<Vec<Document>, _>>()?;
        pipeline.push(doc! { "$skip": i64::try_from(skip).unwrap_or(i64::MAX) });
        pipeline.push(doc! { "$limit": i64::from(effective_page_size.saturating_add(1)) });
        collection
            .aggregate(pipeline)
            .await?
            .try_collect::<Vec<Document>>()
            .await?
    } else {
        let filter = input.get("filter").cloned().unwrap_or_else(|| json!({}));
        let mut find = collection
            .find(mongodb_json_to_document(
                &filter,
                "filter",
                "mongodb-paging-bson",
            )?)
            .skip(skip)
            .limit(i64::from(effective_page_size.saturating_add(1)));

        if let Some(projection) = input.get("projection") {
            find = find.projection(mongodb_json_to_document(
                projection,
                "projection",
                "mongodb-paging-bson",
            )?);
        }

        if let Some(sort) = input.get("sort") {
            find = find.sort(mongodb_json_to_document(
                sort,
                "sort",
                "mongodb-paging-bson",
            )?);
        }

        find.await?.try_collect::<Vec<Document>>().await?
    };
    let bounded = bounded_mongodb_page_documents(&documents, effective_page_size);
    let has_more = bounded.has_more;
    let visible_documents = bounded.documents;
    let buffered_rows = visible_documents.len() as u32;

    Ok(page_response(
        request,
        mongodb_document_payload(
            visible_documents.iter().copied(),
            &database_resolution.database_name,
            collection_name,
            can_use_efficiency_mode(
                &input,
                if input.get("pipeline").is_some() {
                    "aggregate"
                } else {
                    "find"
                },
                request.document_efficiency_mode.unwrap_or(false),
            ),
        ),
        PageResponseInput {
            page_size: effective_page_size,
            page_index,
            buffered_rows,
            has_more,
            next_cursor: None,
            notices: page_notices,
        },
    ))
}

struct BoundedMongoPageDocuments<'a> {
    documents: Vec<&'a Document>,
    has_more: bool,
}

fn bounded_mongodb_page_documents(
    documents: &[Document],
    page_size: u32,
) -> BoundedMongoPageDocuments<'_> {
    let bounded = bounded_items(documents.iter(), page_size);

    BoundedMongoPageDocuments {
        documents: bounded.visible,
        has_more: bounded.truncated,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/paging_tests.rs"]
mod tests;
