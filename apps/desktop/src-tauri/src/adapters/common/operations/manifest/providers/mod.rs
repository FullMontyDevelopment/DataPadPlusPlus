mod document;
mod embedded;
mod graph;
mod keyvalue;
mod search;
mod sql;
mod timeseries;
mod warehouse;
mod widecolumn;

use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend_search(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    search::extend(manifest, operations);
}
pub(super) fn extend_timeseries(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    timeseries::extend(manifest, operations);
}
pub(super) fn extend_graph(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    graph::extend(manifest, operations);
}
pub(super) fn extend_mongodb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    document::extend_mongodb(manifest, operations);
}
pub(super) fn extend_redis(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    keyvalue::extend_redis(manifest, operations);
}
pub(super) fn extend_duckdb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    embedded::extend_duckdb(manifest, operations);
}
pub(super) fn extend_cosmos(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    document::extend_cosmos(manifest, operations);
}
pub(super) fn extend_litedb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    embedded::extend_litedb(manifest, operations);
}
pub(super) fn extend_postgres(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    sql::extend_postgres(manifest, operations);
}
pub(super) fn extend_sqlserver(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    sql::extend_sqlserver(manifest, operations);
}
pub(super) fn extend_warehouse(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    warehouse::extend(manifest, operations);
}
pub(super) fn extend_dynamodb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    widecolumn::extend(manifest, operations);
}
pub(super) fn extend_memcached(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    keyvalue::extend_memcached(manifest, operations);
}
pub(super) fn finalize_litedb(
    manifest: &AdapterManifest,
    operations: &mut [DatastoreOperationManifest],
) {
    embedded::finalize_litedb(manifest, operations);
}

pub(super) fn customize_import_export(
    manifest: &AdapterManifest,
    operation: &mut DatastoreOperationManifest,
) {
    embedded::customize_import_export(manifest, operation);
}
