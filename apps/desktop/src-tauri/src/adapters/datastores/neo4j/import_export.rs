use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use neo4rs::{
    query, BoltDuration, BoltFloat, BoltInteger, BoltList, BoltMap, BoltPoint2D, BoltPoint3D,
    BoltString, BoltType, Graph, Txn,
};
use rand::RngExt;
use serde_json::{json, Map, Value};
use tokio::{
    fs::{self, File},
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
};

use super::super::super::*;
use super::connection::{neo4j_bolt_graph, neo4j_connect_mode};

const TRANSFER_VERSION: u64 = 1;
const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;
const IMPORT_BATCH_SIZE: usize = 500;

struct PendingRelationship {
    id: String,
    start_id: String,
    end_id: String,
    relationship_type: String,
    properties: Map<String, Value>,
}

pub(super) async fn execute_neo4j_import_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if neo4j_connect_mode(connection) != "neo4j-bolt" {
        return Err(CommandError::new(
            "neo4j-transfer-runtime-unsupported",
            "Neo4j graph transfer requires a Bolt connection so native graph values remain typed.",
        ));
    }
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    if parameter_string(request, "format")
        .as_deref()
        .is_some_and(|value| value != "neo4j-json")
    {
        return Err(CommandError::new(
            "neo4j-transfer-format-invalid",
            "Neo4j graph transfer requires the lossless Neo4j JSON Lines format.",
        ));
    }
    let (graph, _, password) = neo4j_bolt_graph(connection).await?;
    let metadata = match mode.as_str() {
        "export" => {
            let path = transfer_path(request, &["targetPath", "outputPath"], "target")?;
            validate_export_path(&path)?;
            export_graph(&graph, &path, &password).await?
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "neo4j-transfer-read-only",
                    "Neo4j graph import is unavailable because this connection is read-only.",
                ));
            }
            require_fail_policy(request)?;
            let path = transfer_path(request, &["sourcePath", "inputPath"], "source")?;
            validate_import_path(&path)?;
            import_graph(&graph, &path, &password).await?
        }
        _ => {
            return Err(CommandError::new(
                "neo4j-transfer-mode-invalid",
                "Neo4j transfer mode must be import or export.",
            ))
        }
    };
    messages.push(format!(
        "Neo4j {mode} completed with authoritative node and relationship counts."
    ));
    Ok(OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: Some(metadata),
        messages,
        warnings,
    })
}

async fn export_graph(graph: &Graph, path: &Path, password: &str) -> Result<Value, CommandError> {
    let temporary = partial_path(path);
    let result = async {
        let file = File::create(&temporary).await.map_err(|_| file_error("neo4j-export-file-failed", "Neo4j export could not create the selected local file."))?;
        let mut output = BufWriter::new(file);
        write_json_line(&mut output, &json!({"format":"datapadplusplus-neo4j-graph","version":TRANSFER_VERSION})).await?;
        let mut node_count = 0_u64;
        let mut nodes = graph.execute(query("MATCH (n) UNWIND CASE WHEN size(keys(n)) = 0 THEN [null] ELSE keys(n) END AS propertyName WITH n, propertyName, CASE WHEN propertyName IS NULL THEN 'NULL' ELSE valueType(n[propertyName]) END AS propertyType RETURN elementId(n) AS id, labels(n) AS labels, propertyName, propertyType, CASE WHEN propertyName IS NULL THEN null WHEN propertyType STARTS WITH 'DATE ' OR propertyType STARTS WITH 'LOCAL DATE' OR propertyType STARTS WITH 'ZONED DATE' OR propertyType STARTS WITH 'TIME ' OR propertyType STARTS WITH 'LOCAL TIME' OR propertyType STARTS WITH 'ZONED TIME' OR propertyType STARTS WITH 'DURATION ' THEN toString(n[propertyName]) WHEN propertyType STARTS WITH 'POINT ' THEN {srid:n[propertyName].srid, x:n[propertyName].x, y:n[propertyName].y, z:CASE WHEN n[propertyName].srid IN [4979, 9157] THEN n[propertyName].z ELSE null END} WHEN propertyType STARTS WITH 'LIST<DATE ' OR propertyType STARTS WITH 'LIST<LOCAL DATE' OR propertyType STARTS WITH 'LIST<ZONED DATE' OR propertyType STARTS WITH 'LIST<TIME ' OR propertyType STARTS WITH 'LIST<LOCAL TIME' OR propertyType STARTS WITH 'LIST<ZONED TIME' OR propertyType STARTS WITH 'LIST<DURATION ' THEN [item IN n[propertyName] | toString(item)] WHEN propertyType STARTS WITH 'LIST<POINT ' THEN [item IN n[propertyName] | {srid:item.srid, x:item.x, y:item.y, z:CASE WHEN item.srid IN [4979, 9157] THEN item.z ELSE null END}] WHEN propertyType STARTS WITH 'LIST<' THEN [item IN n[propertyName] | item] ELSE n[propertyName] END AS portableValue ORDER BY elementId(n), propertyName"))
            .await.map_err(|error| bolt_error("neo4j-export-query-failed", "Neo4j node export failed.", error, password))?;
        let mut pending_node: Option<(String, Vec<String>, Map<String, Value>)> = None;
        while let Some(row) = nodes.next().await.map_err(|error| bolt_error("neo4j-export-read-failed", "Neo4j node export stream failed.", error, password))? {
            let id = row.get::<String>("id").map_err(value_error)?;
            if pending_node.as_ref().is_some_and(|current| current.0 != id) {
                let (id, labels, properties) = pending_node.take().expect("pending node exists");
                write_json_line(&mut output, &json!({"kind":"node","id":id,"labels":labels,"properties":properties})).await?;
                node_count += 1;
            }
            let current = pending_node.get_or_insert_with(|| {
                (id, row.get::<Vec<String>>("labels").unwrap_or_default(), Map::new())
            });
            if current.1.is_empty() {
                current.1 = row.get::<Vec<String>>("labels").map_err(value_error)?;
            }
            if let Ok(property_name) = row.get::<String>("propertyName") {
                let property_type = row.get::<String>("propertyType").map_err(value_error)?;
                let portable_value = row.get::<Value>("portableValue").map_err(value_error)?;
                current.2.insert(property_name, encode_portable_property(&property_type, portable_value)?);
            }
        }
        if let Some((id, labels, properties)) = pending_node.take() {
            write_json_line(&mut output, &json!({"kind":"node","id":id,"labels":labels,"properties":properties})).await?;
            node_count += 1;
        }
        let mut relationship_count = 0_u64;
        let mut relationships = graph.execute(query("MATCH (a)-[r]->(b) UNWIND CASE WHEN size(keys(r)) = 0 THEN [null] ELSE keys(r) END AS propertyName WITH a, r, b, propertyName, CASE WHEN propertyName IS NULL THEN 'NULL' ELSE valueType(r[propertyName]) END AS propertyType RETURN elementId(r) AS id, elementId(a) AS startId, elementId(b) AS endId, type(r) AS relationshipType, propertyName, propertyType, CASE WHEN propertyName IS NULL THEN null WHEN propertyType STARTS WITH 'DATE ' OR propertyType STARTS WITH 'LOCAL DATE' OR propertyType STARTS WITH 'ZONED DATE' OR propertyType STARTS WITH 'TIME ' OR propertyType STARTS WITH 'LOCAL TIME' OR propertyType STARTS WITH 'ZONED TIME' OR propertyType STARTS WITH 'DURATION ' THEN toString(r[propertyName]) WHEN propertyType STARTS WITH 'POINT ' THEN {srid:r[propertyName].srid, x:r[propertyName].x, y:r[propertyName].y, z:CASE WHEN r[propertyName].srid IN [4979, 9157] THEN r[propertyName].z ELSE null END} WHEN propertyType STARTS WITH 'LIST<DATE ' OR propertyType STARTS WITH 'LIST<LOCAL DATE' OR propertyType STARTS WITH 'LIST<ZONED DATE' OR propertyType STARTS WITH 'LIST<TIME ' OR propertyType STARTS WITH 'LIST<LOCAL TIME' OR propertyType STARTS WITH 'LIST<ZONED TIME' OR propertyType STARTS WITH 'LIST<DURATION ' THEN [item IN r[propertyName] | toString(item)] WHEN propertyType STARTS WITH 'LIST<POINT ' THEN [item IN r[propertyName] | {srid:item.srid, x:item.x, y:item.y, z:CASE WHEN item.srid IN [4979, 9157] THEN item.z ELSE null END}] WHEN propertyType STARTS WITH 'LIST<' THEN [item IN r[propertyName] | item] ELSE r[propertyName] END AS portableValue ORDER BY elementId(r), propertyName"))
            .await.map_err(|error| bolt_error("neo4j-export-query-failed", "Neo4j relationship export failed.", error, password))?;
        let mut pending_relationship: Option<PendingRelationship> = None;
        while let Some(row) = relationships.next().await.map_err(|error| bolt_error("neo4j-export-read-failed", "Neo4j relationship export stream failed.", error, password))? {
            let id = row.get::<String>("id").map_err(value_error)?;
            if pending_relationship.as_ref().is_some_and(|current| current.id != id) {
                let current = pending_relationship.take().expect("pending relationship exists");
                write_json_line(&mut output, &json!({"kind":"relationship","id":current.id,"startId":current.start_id,"endId":current.end_id,"relationshipType":current.relationship_type,"properties":current.properties})).await?;
                relationship_count += 1;
            }
            let current = pending_relationship.get_or_insert_with(|| {
                PendingRelationship {
                    id,
                    start_id: row.get::<String>("startId").unwrap_or_default(),
                    end_id: row.get::<String>("endId").unwrap_or_default(),
                    relationship_type: row.get::<String>("relationshipType").unwrap_or_default(),
                    properties: Map::new(),
                }
            });
            if current.start_id.is_empty() {
                current.start_id = row.get::<String>("startId").map_err(value_error)?;
                current.end_id = row.get::<String>("endId").map_err(value_error)?;
                current.relationship_type = row.get::<String>("relationshipType").map_err(value_error)?;
            }
            if let Ok(property_name) = row.get::<String>("propertyName") {
                let property_type = row.get::<String>("propertyType").map_err(value_error)?;
                let portable_value = row.get::<Value>("portableValue").map_err(value_error)?;
                current.properties.insert(property_name, encode_portable_property(&property_type, portable_value)?);
            }
        }
        if let Some(current) = pending_relationship.take() {
            write_json_line(&mut output, &json!({"kind":"relationship","id":current.id,"startId":current.start_id,"endId":current.end_id,"relationshipType":current.relationship_type,"properties":current.properties})).await?;
            relationship_count += 1;
        }
        output.flush().await.map_err(|_| file_error("neo4j-export-file-failed", "Neo4j export could not finish the selected local file."))?;
        drop(output);
        fs::rename(&temporary, path).await.map_err(|_| file_error("neo4j-export-file-failed", "Neo4j export could not publish the completed local artifact."))?;
        let bytes = fs::metadata(path).await.map(|value| value.len()).unwrap_or_default();
        Ok(json!({"workflow":"neo4j.graph.export","format":"neo4j-json","nodeCount":node_count,"relationshipCount":relationship_count,"bytesWritten":bytes}))
    }.await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result
}

async fn import_graph(graph: &Graph, path: &Path, password: &str) -> Result<Value, CommandError> {
    let mut transaction = graph.start_txn().await.map_err(|error| {
        bolt_error(
            "neo4j-import-transaction-failed",
            "Neo4j could not start the import transaction.",
            error,
            password,
        )
    })?;
    let result = import_graph_transaction(&mut transaction, path, password).await;
    match result {
        Ok(metadata) => {
            transaction.commit().await.map_err(|error| {
                bolt_error(
                    "neo4j-import-commit-failed",
                    "Neo4j could not commit the graph import.",
                    error,
                    password,
                )
            })?;
            Ok(metadata)
        }
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

async fn import_graph_transaction(
    transaction: &mut Txn,
    path: &Path,
    password: &str,
) -> Result<Value, CommandError> {
    let mut count_stream = transaction
        .execute(query("MATCH (n) RETURN count(n) AS nodeCount"))
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-preflight-failed",
                "Neo4j import could not inspect the target graph.",
                error,
                password,
            )
        })?;
    let count_row = count_stream
        .next(&mut *transaction)
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-preflight-failed",
                "Neo4j import could not read the target graph count.",
                error,
                password,
            )
        })?
        .ok_or_else(|| {
            CommandError::new(
                "neo4j-import-preflight-failed",
                "Neo4j did not return a target graph count.",
            )
        })?;
    if count_row.get::<i64>("nodeCount").map_err(value_error)? != 0 {
        return Err(CommandError::new("neo4j-import-target-not-empty", "Neo4j graph import requires an empty target database and never overwrites or merges existing data."));
    }
    drop(count_stream);

    let file = File::open(path).await.map_err(|_| {
        file_error(
            "neo4j-import-file-failed",
            "Neo4j import could not open the selected local file.",
        )
    })?;
    let mut lines = BufReader::new(file).lines();
    let header = next_record(&mut lines).await?.ok_or_else(|| {
        CommandError::new(
            "neo4j-import-format-invalid",
            "The Neo4j transfer file is empty.",
        )
    })?;
    if header.get("format").and_then(Value::as_str) != Some("datapadplusplus-neo4j-graph")
        || header.get("version").and_then(Value::as_u64) != Some(TRANSFER_VERSION)
    {
        return Err(CommandError::new(
            "neo4j-import-format-invalid",
            "The selected file is not a supported DataPad++ Neo4j graph transfer.",
        ));
    }
    let transfer_key = format!("__datapad_transfer_{:016x}", rand::rng().random::<u64>());
    let mut node_count = 0_u64;
    let mut relationship_count = 0_u64;
    let mut saw_relationship = false;
    let mut node_batches = BTreeMap::<Vec<String>, Vec<BoltMap>>::new();
    let mut relationship_batches = BTreeMap::<String, Vec<BoltMap>>::new();
    while let Some(record) = next_record(&mut lines).await? {
        match record.get("kind").and_then(Value::as_str) {
            Some("node") if !saw_relationship => {
                let (labels, row) = decode_node(&record, &transfer_key)?;
                let batch = node_batches.entry(labels.clone()).or_default();
                batch.push(row);
                if batch.len() >= IMPORT_BATCH_SIZE {
                    let batch = node_batches.remove(&labels).unwrap_or_default();
                    node_count +=
                        import_node_batch(transaction, &labels, batch, &transfer_key, password)
                            .await?;
                }
            }
            Some("relationship") => {
                if !saw_relationship {
                    node_count +=
                        flush_node_batches(transaction, &mut node_batches, &transfer_key, password)
                            .await?;
                }
                saw_relationship = true;
                let (relationship_type, row) = decode_relationship(&record, &transfer_key)?;
                let batch = relationship_batches
                    .entry(relationship_type.clone())
                    .or_default();
                batch.push(row);
                if batch.len() >= IMPORT_BATCH_SIZE {
                    let batch = relationship_batches
                        .remove(&relationship_type)
                        .unwrap_or_default();
                    relationship_count += import_relationship_batch(
                        transaction,
                        &relationship_type,
                        batch,
                        &transfer_key,
                        password,
                    )
                    .await?;
                }
            }
            Some("node") => {
                return Err(CommandError::new(
                    "neo4j-import-order-invalid",
                    "Neo4j transfer nodes must appear before relationships.",
                ))
            }
            _ => {
                return Err(CommandError::new(
                    "neo4j-import-record-invalid",
                    "Neo4j transfer contains an unrecognized record.",
                ))
            }
        }
    }
    node_count +=
        flush_node_batches(transaction, &mut node_batches, &transfer_key, password).await?;
    relationship_count += flush_relationship_batches(
        transaction,
        &mut relationship_batches,
        &transfer_key,
        password,
    )
    .await?;
    transaction
        .run(query(&format!(
            "MATCH (n) REMOVE n.{}",
            quote_identifier(&transfer_key)?
        )))
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-cleanup-failed",
                "Neo4j import could not remove its temporary identity metadata.",
                error,
                password,
            )
        })?;
    Ok(
        json!({"workflow":"neo4j.graph.import","format":"neo4j-json","nodeCount":node_count,"relationshipCount":relationship_count,"conflictPolicy":"fail"}),
    )
}

fn decode_node(record: &Value, transfer_key: &str) -> Result<(Vec<String>, BoltMap), CommandError> {
    let id = required_string(record, "id")?;
    let mut labels = record
        .get("labels")
        .and_then(Value::as_array)
        .ok_or_else(|| record_error("Neo4j node labels are missing."))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| record_error("Neo4j node label is invalid."))
        })
        .collect::<Result<Vec<_>, _>>()?;
    labels.sort();
    labels.dedup();
    for label in &labels {
        let _ = quote_identifier(label)?;
    }
    let properties = decode_properties(record.get("properties"), transfer_key)?;
    let row = [
        (BoltString::from("id"), BoltType::from(id)),
        (BoltString::from("properties"), BoltType::Map(properties)),
    ]
    .into_iter()
    .collect();
    Ok((labels, row))
}

fn decode_relationship(
    record: &Value,
    transfer_key: &str,
) -> Result<(String, BoltMap), CommandError> {
    let relationship_type = required_string(record, "relationshipType")?;
    let _ = quote_identifier(&relationship_type)?;
    let properties = decode_properties(record.get("properties"), transfer_key)?;
    let row = [
        (
            BoltString::from("startId"),
            BoltType::from(required_string(record, "startId")?),
        ),
        (
            BoltString::from("endId"),
            BoltType::from(required_string(record, "endId")?),
        ),
        (BoltString::from("properties"), BoltType::Map(properties)),
    ]
    .into_iter()
    .collect();
    Ok((relationship_type, row))
}

async fn flush_node_batches(
    transaction: &mut Txn,
    batches: &mut BTreeMap<Vec<String>, Vec<BoltMap>>,
    transfer_key: &str,
    password: &str,
) -> Result<u64, CommandError> {
    let pending = std::mem::take(batches);
    let mut count = 0;
    for (labels, batch) in pending {
        count += import_node_batch(transaction, &labels, batch, transfer_key, password).await?;
    }
    Ok(count)
}

async fn import_node_batch(
    transaction: &mut Txn,
    labels: &[String],
    rows: Vec<BoltMap>,
    transfer_key: &str,
    password: &str,
) -> Result<u64, CommandError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let count = rows.len() as u64;
    let labels = labels
        .iter()
        .map(|value| quote_identifier(value))
        .collect::<Result<Vec<_>, _>>()?;
    let cypher = format!(
        "UNWIND $rows AS row CREATE (n{}) SET n = row.properties SET n.{} = row.id",
        labels
            .iter()
            .map(|label| format!(":{label}"))
            .collect::<String>(),
        quote_identifier(transfer_key)?
    );
    transaction
        .run(query(&cypher).param(
            "rows",
            BoltType::List(BoltList::from(
                rows.into_iter().map(BoltType::Map).collect::<Vec<_>>(),
            )),
        ))
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-node-failed",
                "Neo4j rejected an imported node.",
                error,
                password,
            )
        })?;
    Ok(count)
}

async fn flush_relationship_batches(
    transaction: &mut Txn,
    batches: &mut BTreeMap<String, Vec<BoltMap>>,
    transfer_key: &str,
    password: &str,
) -> Result<u64, CommandError> {
    let pending = std::mem::take(batches);
    let mut count = 0;
    for (relationship_type, batch) in pending {
        count += import_relationship_batch(
            transaction,
            &relationship_type,
            batch,
            transfer_key,
            password,
        )
        .await?;
    }
    Ok(count)
}

async fn import_relationship_batch(
    transaction: &mut Txn,
    relationship_type: &str,
    rows: Vec<BoltMap>,
    transfer_key: &str,
    password: &str,
) -> Result<u64, CommandError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let expected = rows.len() as i64;
    let relationship_type = quote_identifier(relationship_type)?;
    let key = quote_identifier(transfer_key)?;
    let cypher = format!("UNWIND $rows AS row MATCH (a), (b) WHERE a.{key} = row.startId AND b.{key} = row.endId CREATE (a)-[r:{relationship_type}]->(b) SET r = row.properties RETURN count(r) AS created");
    let mut stream = transaction
        .execute(query(&cypher).param(
            "rows",
            BoltType::List(BoltList::from(
                rows.into_iter().map(BoltType::Map).collect::<Vec<_>>(),
            )),
        ))
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-relationship-failed",
                "Neo4j rejected an imported relationship.",
                error,
                password,
            )
        })?;
    let row = stream
        .next(&mut *transaction)
        .await
        .map_err(|error| {
            bolt_error(
                "neo4j-import-relationship-failed",
                "Neo4j could not confirm imported relationships.",
                error,
                password,
            )
        })?
        .ok_or_else(|| record_error("Neo4j did not confirm imported relationships."))?;
    let created = row.get::<i64>("created").map_err(value_error)?;
    if created != expected {
        return Err(record_error(
            "Neo4j relationship endpoints were missing from the transfer.",
        ));
    }
    Ok(created as u64)
}

fn decode_properties(value: Option<&Value>, transfer_key: &str) -> Result<BoltMap, CommandError> {
    let object = value
        .and_then(Value::as_object)
        .ok_or_else(|| record_error("Neo4j properties are missing."))?;
    if object.contains_key(transfer_key) {
        return Err(record_error(
            "Neo4j transfer property collides with temporary import metadata.",
        ));
    }
    object
        .iter()
        .map(|(key, value)| Ok((BoltString::from(key.as_str()), decode_value(value)?)))
        .collect()
}

fn decode_value(value: &Value) -> Result<BoltType, CommandError> {
    if let Some(tag) = value.get("$neo4j").and_then(Value::as_object) {
        let kind = tag
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| record_error("Neo4j typed value has no type."))?;
        let text = || {
            tag.get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| record_error("Neo4j typed value is invalid."))
        };
        return Ok(match kind {
            "bytes" => BASE64
                .decode(text()?)
                .map_err(|_| record_error("Neo4j binary value is invalid Base64."))?
                .into(),
            "date" => NaiveDate::parse_from_str(text()?, "%Y-%m-%d")
                .map_err(|_| record_error("Neo4j date value is invalid."))?
                .into(),
            "local-time" => NaiveTime::parse_from_str(text()?, "%H:%M:%S%.f")
                .map_err(|_| record_error("Neo4j local time value is invalid."))?
                .into(),
            "time" => parse_time(text()?)?.into(),
            "date-time" => DateTime::parse_from_rfc3339(text()?)
                .map_err(|_| record_error("Neo4j date-time value is invalid."))?
                .into(),
            "local-date-time" => NaiveDateTime::parse_from_str(text()?, "%Y-%m-%dT%H:%M:%S%.f")
                .map_err(|_| record_error("Neo4j local date-time value is invalid."))?
                .into(),
            "zoned-date-time" => {
                let date = NaiveDateTime::parse_from_str(text()?, "%Y-%m-%dT%H:%M:%S%.f")
                    .map_err(|_| record_error("Neo4j zoned date-time value is invalid."))?;
                let zone = tag
                    .get("zoneId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| record_error("Neo4j zoned date-time has no zone ID."))?;
                BoltType::from((date, zone))
            }
            "duration" => BoltType::Duration(parse_duration(text()?)?),
            "point-2d" => BoltType::Point2D(BoltPoint2D {
                sr_id: BoltInteger::new(required_i64(tag, "srid")?),
                x: BoltFloat::new(required_f64(tag, "x")?),
                y: BoltFloat::new(required_f64(tag, "y")?),
            }),
            "point-3d" => BoltType::Point3D(BoltPoint3D {
                sr_id: BoltInteger::new(required_i64(tag, "srid")?),
                x: BoltFloat::new(required_f64(tag, "x")?),
                y: BoltFloat::new(required_f64(tag, "y")?),
                z: BoltFloat::new(required_f64(tag, "z")?),
            }),
            _ => return Err(record_error("Neo4j typed value uses an unsupported type.")),
        });
    }
    match value {
        Value::Null => Ok(BoltType::Null(Default::default())),
        Value::Bool(value) => Ok((*value).into()),
        Value::Number(value) if value.is_i64() => Ok(value.as_i64().unwrap_or_default().into()),
        Value::Number(value) => value
            .as_f64()
            .map(BoltType::from)
            .ok_or_else(|| record_error("Neo4j number is invalid.")),
        Value::String(value) => Ok(value.as_str().into()),
        Value::Array(values) => Ok(BoltType::List(BoltList::from(
            values
                .iter()
                .map(decode_value)
                .collect::<Result<Vec<_>, _>>()?,
        ))),
        Value::Object(_) => Err(record_error(
            "Neo4j property maps are not a native property value.",
        )),
    }
}

fn parse_time(value: &str) -> Result<(NaiveTime, FixedOffset), CommandError> {
    let datetime = DateTime::parse_from_rfc3339(&format!("1970-01-01T{value}"))
        .map_err(|_| record_error("Neo4j time value is invalid."))?;
    Ok((datetime.time(), *datetime.offset()))
}

fn parse_duration(value: &str) -> Result<BoltDuration, CommandError> {
    let value = value
        .strip_prefix('P')
        .ok_or_else(|| record_error("Neo4j duration value is invalid."))?;
    let (date, time) = value.split_once('T').map_or((value, ""), |parts| parts);
    let years = duration_component(date, 'Y')?.unwrap_or_default();
    let month_component = duration_component(date, 'M')?.unwrap_or_default();
    let months = years
        .checked_mul(12)
        .and_then(|value| value.checked_add(month_component))
        .ok_or_else(|| record_error("Neo4j duration value is out of range."))?;
    let days = duration_component(date, 'D')?.unwrap_or_default();
    let hours = duration_component(time, 'H')?.unwrap_or_default();
    let minutes = duration_component(time, 'M')?.unwrap_or_default();
    let (seconds, nanos) = if let Some(second_text) = component_text(time, 'S') {
        let (whole, fraction) = second_text.split_once('.').unwrap_or((second_text, ""));
        let seconds = whole
            .parse::<i64>()
            .map_err(|_| record_error("Neo4j duration value is invalid."))?;
        if fraction.len() > 9 || !fraction.chars().all(|value| value.is_ascii_digit()) {
            return Err(record_error("Neo4j duration value is invalid."));
        }
        let nanos = if fraction.is_empty() {
            0
        } else {
            format!("{fraction:0<9}")
                .parse::<i64>()
                .map_err(|_| record_error("Neo4j duration value is invalid."))?
        };
        (seconds, nanos)
    } else {
        (0, 0)
    };
    let seconds = hours * 3600 + minutes * 60 + seconds;
    Ok(BoltDuration::new(
        months.into(),
        days.into(),
        seconds.into(),
        nanos.into(),
    ))
}

fn duration_component(value: &str, suffix: char) -> Result<Option<i64>, CommandError> {
    component_text(value, suffix)
        .map(str::parse)
        .transpose()
        .map_err(|_| record_error("Neo4j duration value is invalid."))
}

fn component_text(value: &str, suffix: char) -> Option<&str> {
    let end = value.find(suffix)?;
    let start = value[..end]
        .rfind(|character: char| {
            !character.is_ascii_digit() && character != '-' && character != '.'
        })
        .map_or(0, |index| index + 1);
    (start < end).then_some(&value[start..end])
}

async fn next_record(
    lines: &mut tokio::io::Lines<BufReader<File>>,
) -> Result<Option<Value>, CommandError> {
    let Some(line) = lines.next_line().await.map_err(|_| {
        file_error(
            "neo4j-import-file-failed",
            "Neo4j import could not read the selected local file.",
        )
    })?
    else {
        return Ok(None);
    };
    if line.len() > MAX_LINE_BYTES {
        return Err(record_error(
            "Neo4j transfer record exceeds the 64 MiB safety limit.",
        ));
    }
    serde_json::from_str(&line)
        .map(Some)
        .map_err(|_| record_error("Neo4j transfer contains invalid JSON Lines."))
}

async fn write_json_line(output: &mut BufWriter<File>, value: &Value) -> Result<(), CommandError> {
    let mut encoded = serde_json::to_vec(value)
        .map_err(|_| record_error("Neo4j transfer record could not be encoded."))?;
    encoded.push(b'\n');
    output.write_all(&encoded).await.map_err(|_| {
        file_error(
            "neo4j-export-file-failed",
            "Neo4j export could not write the selected local file.",
        )
    })
}

fn required_string(value: &Value, key: &str) -> Result<String, CommandError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| record_error("Neo4j transfer record is missing an identity field."))
}
fn encode_portable_property(property_type: &str, value: Value) -> Result<Value, CommandError> {
    let property_type = property_type
        .strip_suffix(" NOT NULL")
        .unwrap_or(property_type);
    if let Some(inner) = property_type
        .strip_prefix("LIST<")
        .and_then(|value| value.strip_suffix('>'))
    {
        return value
            .as_array()
            .ok_or_else(|| transfer_value_error("Neo4j returned invalid list property metadata."))?
            .iter()
            .cloned()
            .map(|value| encode_portable_property(inner, value))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array);
    }
    let tagged = |kind: &str, value: Value| json!({"$neo4j":{"type":kind,"value":value}});
    match property_type {
        "DATE" => Ok(tagged("date", require_transfer_string(value)?)),
        "LOCAL TIME" => Ok(tagged("local-time", require_transfer_string(value)?)),
        "TIME" | "ZONED TIME" => Ok(tagged("time", require_transfer_string(value)?)),
        "LOCAL DATETIME" => Ok(tagged("local-date-time", require_transfer_string(value)?)),
        "DATETIME" | "ZONED DATETIME" => encode_zoned_datetime(value),
        "DURATION" => Ok(tagged("duration", require_transfer_string(value)?)),
        "POINT" => encode_point(value),
        _ => Ok(value),
    }
}

fn require_transfer_string(value: Value) -> Result<Value, CommandError> {
    if value.is_string() {
        Ok(value)
    } else {
        Err(transfer_value_error(
            "Neo4j returned invalid temporal property metadata.",
        ))
    }
}

fn encode_zoned_datetime(value: Value) -> Result<Value, CommandError> {
    let text = value.as_str().ok_or_else(|| {
        transfer_value_error("Neo4j returned invalid date-time property metadata.")
    })?;
    if let Some((date_with_offset, zone)) = text
        .strip_suffix(']')
        .and_then(|value| value.rsplit_once('['))
    {
        let local = DateTime::parse_from_rfc3339(date_with_offset)
            .map_err(|_| transfer_value_error("Neo4j returned an invalid zoned date-time."))?
            .naive_local()
            .format("%Y-%m-%dT%H:%M:%S%.f")
            .to_string();
        Ok(json!({"$neo4j":{"type":"zoned-date-time","value":local,"zoneId":zone}}))
    } else {
        DateTime::parse_from_rfc3339(text)
            .map_err(|_| transfer_value_error("Neo4j returned an invalid date-time."))?;
        Ok(json!({"$neo4j":{"type":"date-time","value":text}}))
    }
}

fn encode_point(value: Value) -> Result<Value, CommandError> {
    let point = value
        .as_object()
        .ok_or_else(|| transfer_value_error("Neo4j returned invalid spatial property metadata."))?;
    let srid = required_i64(point, "srid")?;
    let x = required_f64(point, "x")?;
    let y = required_f64(point, "y")?;
    if let Some(z) = point.get("z").and_then(Value::as_f64) {
        Ok(json!({"$neo4j":{"type":"point-3d","srid":srid,"x":x,"y":y,"z":z}}))
    } else {
        Ok(json!({"$neo4j":{"type":"point-2d","srid":srid,"x":x,"y":y}}))
    }
}

fn transfer_value_error(message: &str) -> CommandError {
    CommandError::new("neo4j-transfer-value-invalid", message)
}
fn required_i64(value: &Map<String, Value>, key: &str) -> Result<i64, CommandError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| record_error("Neo4j typed integer field is invalid."))
}
fn required_f64(value: &Map<String, Value>, key: &str) -> Result<f64, CommandError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| record_error("Neo4j typed numeric field is invalid."))
}
fn quote_identifier(value: &str) -> Result<String, CommandError> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        Err(record_error(
            "Neo4j label, relationship type, or temporary property name is invalid.",
        ))
    } else {
        Ok(format!("`{}`", value.replace('`', "``")))
    }
}
fn record_error(message: &str) -> CommandError {
    CommandError::new("neo4j-import-record-invalid", message)
}
fn value_error(error: neo4rs::DeError) -> CommandError {
    CommandError::new(
        "neo4j-transfer-value-invalid",
        format!(
            "Neo4j returned a graph value that could not be encoded losslessly. Driver type error: {error}"
        ),
    )
}
fn file_error(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}
fn bolt_error(code: &str, fallback: &str, error: neo4rs::Error, password: &str) -> CommandError {
    let detail = error.to_string();
    if detail.len() > 700 || (!password.is_empty() && detail.contains(password)) {
        CommandError::new(code, fallback)
    } else {
        CommandError::new(code, format!("{fallback} {detail}"))
    }
}
fn partial_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(format!(".partial-{:016x}", rand::rng().random::<u64>()));
    PathBuf::from(value)
}
fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    object_key: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys
        .iter()
        .find_map(|key| parameter_string(request, key))
        .or_else(|| {
            request
                .parameters
                .as_ref()?
                .get(object_key)?
                .as_object()?
                .get("path")?
                .as_str()
                .map(str::to_string)
        })
        .ok_or_else(|| {
            CommandError::new(
                "neo4j-transfer-path-missing",
                "Choose a local Neo4j graph transfer file.",
            )
        })?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "neo4j-transfer-path-invalid",
            "Neo4j transfer requires an absolute local file selection.",
        ));
    }
    Ok(path)
}
fn validate_export_path(path: &Path) -> Result<(), CommandError> {
    if path.exists() {
        return Err(CommandError::new(
            "neo4j-export-target-exists",
            "The selected Neo4j export file already exists.",
        ));
    }
    if path.parent().is_none_or(|value| !value.is_dir()) {
        return Err(CommandError::new(
            "neo4j-export-folder-missing",
            "The selected Neo4j export folder does not exist.",
        ));
    }
    Ok(())
}
fn validate_import_path(path: &Path) -> Result<(), CommandError> {
    if path.is_file() {
        Ok(())
    } else {
        Err(CommandError::new(
            "neo4j-import-file-missing",
            "The selected Neo4j transfer file does not exist.",
        ))
    }
}
fn require_fail_policy(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    if parameter_string(request, "conflictPolicy").as_deref() == Some("fail") {
        Ok(())
    } else {
        Err(CommandError::new(
            "neo4j-import-conflict-policy-invalid",
            "Neo4j import requires the fail-safe conflict policy.",
        ))
    }
}
fn parameter_string(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neo4j/import_export_tests.rs"]
mod tests;
