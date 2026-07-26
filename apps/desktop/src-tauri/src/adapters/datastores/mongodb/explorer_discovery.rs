use futures_util::TryStreamExt;
use mongodb::{
    bson::{self, Document},
    error::{Error, ErrorKind},
    results::CollectionType,
    Client, Collection, Database,
};

use crate::domain::error::CommandError;

#[derive(Clone)]
pub(super) struct MongoCollectionInfo {
    pub name: String,
    pub collection_type: CollectionType,
    pub options: Document,
}

impl MongoCollectionInfo {
    pub fn is_view(&self) -> bool {
        self.collection_type == CollectionType::View
    }

    pub fn is_time_series(&self) -> bool {
        self.collection_type == CollectionType::Timeseries
            || self.options.contains_key("timeseries")
    }

    pub fn is_capped(&self) -> bool {
        self.options.get_bool("capped").unwrap_or(false)
    }

    pub fn type_label(&self) -> &'static str {
        match self.collection_type {
            CollectionType::View => "view",
            CollectionType::Timeseries => "timeseries",
            _ => "collection",
        }
    }
}

pub(super) async fn list_authorized_database_names(client: &Client) -> Result<Vec<String>, Error> {
    let mut database_names = client
        .list_database_names()
        .authorized_databases(true)
        .await?;
    database_names.sort_by_key(|name| name.to_lowercase());
    database_names.dedup();
    Ok(database_names)
}

pub(super) async fn list_collection_infos(
    database: &Database,
) -> Result<Vec<MongoCollectionInfo>, CommandError> {
    let specifications = database
        .list_collections()
        .await?
        .try_collect::<Vec<_>>()
        .await?;
    let mut infos = specifications
        .into_iter()
        .map(|specification| MongoCollectionInfo {
            name: specification.name,
            collection_type: specification.collection_type,
            options: bson::to_document(&specification.options).unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    infos.sort_by_key(|info| info.name.to_lowercase());
    Ok(infos)
}

pub(super) async fn list_index_documents(
    collection: &Collection<Document>,
) -> Result<Vec<Document>, CommandError> {
    let indexes = collection
        .list_indexes()
        .await?
        .try_collect::<Vec<_>>()
        .await?;
    indexes
        .iter()
        .map(bson::to_document)
        .collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::from)
}

pub(super) async fn collection_info_by_name(
    database: &Database,
    collection_name: &str,
) -> Result<Option<MongoCollectionInfo>, CommandError> {
    Ok(list_collection_infos(database)
        .await?
        .into_iter()
        .find(|item| item.name == collection_name))
}

pub(super) fn is_authorization_error(error: &Error) -> bool {
    match error.kind.as_ref() {
        ErrorKind::Authentication { .. } => true,
        ErrorKind::Command(command) => {
            command.code == 13
                || command.code_name.eq_ignore_ascii_case("Unauthorized")
                || command.message.to_lowercase().contains("not authorized")
        }
        _ => {
            let message = error.to_string().to_lowercase();
            message.contains("not authorized")
                || message.contains("unauthorized")
                || message.contains("permission denied")
        }
    }
}

pub(super) fn is_gridfs_collection(collection_name: &str) -> bool {
    collection_name.ends_with(".files") || collection_name.ends_with(".chunks")
}
