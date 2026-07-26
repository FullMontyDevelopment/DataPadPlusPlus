use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Document},
    Client,
};

use super::explorer_discovery::{collection_info_by_name, list_index_documents};
use crate::domain::error::CommandError;

pub(super) struct MongoCollectionInspection {
    pub sample_documents: Vec<Document>,
    pub indexes: Option<Vec<Document>>,
    pub validator: Option<Document>,
    pub statistics: Option<Document>,
}

pub(super) async fn inspect_collection(
    client: &Client,
    database_name: &str,
    collection_name: &str,
) -> Result<MongoCollectionInspection, CommandError> {
    let database = client.database(database_name);
    let collection = database.collection::<Document>(collection_name);
    let sample_documents = collection
        .find(doc! {})
        .limit(3)
        .await?
        .try_collect::<Vec<Document>>()
        .await?;
    let indexes = list_index_documents(&collection).await.ok();
    let validator = collection_info_by_name(&database, collection_name)
        .await?
        .and_then(|item| item.options.get_document("validator").ok().cloned());
    let statistics = database
        .run_command(doc! { "collStats": collection_name, "scale": 1 })
        .await
        .ok();

    Ok(MongoCollectionInspection {
        sample_documents,
        indexes,
        validator,
        statistics,
    })
}
