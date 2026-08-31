use std::path::{Path, PathBuf};

use rand::RngExt;
use serde_json::{json, Map, Value};
use tokio::{
    fs::{self, File},
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
};

use super::super::super::*;
use super::connection::{
    janusgraph_connect_mode, janusgraph_run_gremlin, janusgraph_websocket_error, JanusGraphEndpoint,
};

const TRANSFER_VERSION: u64 = 1;
const PAGE_SIZE: usize = 200;
const IMPORT_BATCH_SIZE: usize = 25;
const MAX_IMPORT_BATCH_BYTES: usize = 40 * 1024;
const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;
const SCHEMA_QUERY: &str = "mgmt = graph.openManagement(); try { [propertyKeys:mgmt.getRelationTypes(org.janusgraph.core.PropertyKey.class).collect{ [name:it.name(), dataType:it.dataType().name, cardinality:it.cardinality().name()] }.sort{a,b -> a.name <=> b.name}, vertexLabels:mgmt.getVertexLabels().collect{ [name:it.name(), partitioned:it.isPartitioned(), staticLabel:it.isStatic()] }.sort{a,b -> a.name <=> b.name}, edgeLabels:mgmt.getRelationTypes(org.janusgraph.core.EdgeLabel.class).collect{ [name:it.name(), multiplicity:it.multiplicity().name(), unidirected:it.isUnidirected()] }.sort{a,b -> a.name <=> b.name}, vertexIndexes:mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.Vertex.class).collect{ [name:it.name(), unique:it.isUnique(), backingIndex:it.backingIndex(), keys:it.fieldKeys().collect{ key -> key.name() }.sort()] }.sort{a,b -> a.name <=> b.name}, edgeIndexes:mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.Edge.class).collect{ [name:it.name(), unique:it.isUnique(), backingIndex:it.backingIndex(), keys:it.fieldKeys().collect{ key -> key.name() }.sort()] }.sort{a,b -> a.name <=> b.name}] } finally { mgmt.rollback() }";
const VERTEX_PAGE_QUERY: &str = "g.V().order().by(org.apache.tinkerpop.gremlin.structure.T.id).range(offset, offset + pageSize).map{ def vertex = it.get(); [id:vertex.id(), label:vertex.label(), properties:vertex.properties().collect{ property -> def propertyValue = property.value(); [id:property.id(), key:property.key(), value:propertyValue instanceof byte[] ? [datapadType:'janusgraph-byte-array', base64:java.util.Base64.encoder.encodeToString(propertyValue)] : propertyValue, meta:property.properties().collect{ meta -> def metaValue = meta.value(); [key:meta.key(), value:metaValue instanceof byte[] ? [datapadType:'janusgraph-byte-array', base64:java.util.Base64.encoder.encodeToString(metaValue)] : metaValue] }.sort{a,b -> a.key <=> b.key}] }.sort{a,b -> a.key <=> b.key}] }";
const EDGE_PAGE_QUERY: &str = "g.E().order().by(org.apache.tinkerpop.gremlin.structure.T.id).range(offset, offset + pageSize).map{ def edge = it.get(); [id:edge.id(), label:edge.label(), outId:edge.outVertex().id(), inId:edge.inVertex().id(), properties:edge.properties().collect{ property -> def propertyValue = property.value(); [key:property.key(), value:propertyValue instanceof byte[] ? [datapadType:'janusgraph-byte-array', base64:java.util.Base64.encoder.encodeToString(propertyValue)] : propertyValue] }.sort{a,b -> a.key <=> b.key}] }";
const IMPORT_VERTICES_QUERY: &str = "rows.each { row -> def vertex = graph.addVertex(org.apache.tinkerpop.gremlin.structure.T.label, row.label); transferVertices[row.id] = vertex; row.properties.each { property -> def propertyValue = property.value instanceof Map && property.value.datapadType == 'janusgraph-byte-array' ? java.util.Base64.decoder.decode(property.value.base64) : property.value; def created = vertex.property(property.key, propertyValue); property.meta.each { meta -> def metaValue = meta.value instanceof Map && meta.value.datapadType == 'janusgraph-byte-array' ? java.util.Base64.decoder.decode(meta.value.base64) : meta.value; created.property(meta.key, metaValue) } } }; rows.size()";
const IMPORT_EDGES_QUERY: &str = "rows.each { row -> def outVertex = transferVertices[row.outId]; def inVertex = transferVertices[row.inId]; if (outVertex == null || inVertex == null) { throw new IllegalStateException('A transfer edge references a missing vertex.') }; def edge = outVertex.addEdge(row.label, inVertex); row.properties.each { property -> def propertyValue = property.value instanceof Map && property.value.datapadType == 'janusgraph-byte-array' ? java.util.Base64.decoder.decode(property.value.base64) : property.value; edge.property(property.key, propertyValue) } }; rows.size()";

struct ImportInventory {
    schema: Value,
    vertices: u64,
    edges: u64,
}

pub(super) async fn execute_janusgraph_import_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if janusgraph_connect_mode(connection) != "gremlin-websocket" {
        return Err(CommandError::new(
            "janusgraph-transfer-runtime-unsupported",
            "JanusGraph GraphSON transfer requires a Gremlin WebSocket connection.",
        ));
    }
    if parameter_string(request, "format")
        .as_deref()
        .is_some_and(|value| value != "graphson3")
    {
        return Err(CommandError::new(
            "janusgraph-transfer-format-invalid",
            "JanusGraph transfer requires the lossless GraphSON 3 format.",
        ));
    }
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    let metadata = match mode.as_str() {
        "export" => {
            let path = transfer_path(request, &["targetPath", "outputPath"], "target")?;
            validate_export_path(&path)?;
            export_graph(connection, &path).await?
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "janusgraph-transfer-read-only",
                    "JanusGraph import is unavailable because this connection is read-only.",
                ));
            }
            require_fail_policy(request)?;
            let path = transfer_path(request, &["sourcePath", "inputPath"], "source")?;
            validate_import_path(&path)?;
            import_graph(connection, &path).await?
        }
        _ => {
            return Err(CommandError::new(
                "janusgraph-transfer-mode-invalid",
                "JanusGraph transfer mode must be import or export.",
            ))
        }
    };
    messages.push(format!(
        "JanusGraph {mode} completed with authoritative vertex and edge counts."
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

async fn export_graph(
    connection: &ResolvedConnectionProfile,
    path: &Path,
) -> Result<Value, CommandError> {
    let temporary = partial_path(path);
    let result = async {
        let file = File::create(&temporary).await.map_err(|_| {
            file_error(
                "janusgraph-export-file-failed",
                "JanusGraph export could not create the selected local file.",
            )
        })?;
        let mut output = BufWriter::new(file);
        write_json_line(
            &mut output,
            &json!({"format":"datapadplusplus-janusgraph-graphson","version":TRANSFER_VERSION,"graphson":"3.0"}),
        )
        .await?;
        let schema = transfer_query(connection, SCHEMA_QUERY, &Map::new()).await?;
        let schema = response_items(&schema)
            .first()
            .cloned()
            .ok_or_else(|| transfer_error("JanusGraph did not return schema metadata."))?;
        write_json_line(&mut output, &json!({"kind":"schema","graphson":schema})).await?;

        let vertex_count = export_pages(
            connection,
            &mut output,
            "vertex",
            VERTEX_PAGE_QUERY,
        )
        .await?;
        let edge_count =
            export_pages(connection, &mut output, "edge", EDGE_PAGE_QUERY).await?;
        output.flush().await.map_err(|_| {
            file_error(
                "janusgraph-export-file-failed",
                "JanusGraph export could not finish the selected local file.",
            )
        })?;
        drop(output);
        fs::rename(&temporary, path).await.map_err(|_| {
            file_error(
                "janusgraph-export-file-failed",
                "JanusGraph export could not publish the completed local artifact.",
            )
        })?;
        let bytes = fs::metadata(path)
            .await
            .map(|value| value.len())
            .unwrap_or_default();
        Ok(json!({"workflow":"janusgraph.graph.export","format":"graphson3","vertexCount":vertex_count,"edgeCount":edge_count,"bytesWritten":bytes}))
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result
}

async fn export_pages(
    connection: &ResolvedConnectionProfile,
    output: &mut BufWriter<File>,
    kind: &str,
    query: &str,
) -> Result<u64, CommandError> {
    let mut offset = 0_u64;
    loop {
        let bindings = Map::from_iter([
            ("offset".into(), json!(offset)),
            ("pageSize".into(), json!(PAGE_SIZE)),
        ]);
        let response = transfer_query(connection, query, &bindings).await?;
        let items = response_items(&response);
        for item in &items {
            write_json_line(output, &json!({"kind":kind,"graphson":item})).await?;
        }
        offset += items.len() as u64;
        if items.len() < PAGE_SIZE {
            return Ok(offset);
        }
    }
}

async fn import_graph(
    connection: &ResolvedConnectionProfile,
    path: &Path,
) -> Result<Value, CommandError> {
    let inventory = validate_import_file(path).await?;
    let target_count = janusgraph_run_gremlin(connection, "g.V().limit(1).count()")
        .await
        .and_then(|value| decoded_count(&value))?;
    if target_count != 0 {
        return Err(CommandError::new(
            "janusgraph-import-target-not-empty",
            "JanusGraph import requires an existing empty graph when conflict policy is fail.",
        ));
    }
    let target_schema = transfer_query(connection, SCHEMA_QUERY, &Map::new()).await?;
    let target_schema = response_items(&target_schema)
        .first()
        .cloned()
        .ok_or_else(|| transfer_error("JanusGraph did not return target schema metadata."))?;
    if target_schema != inventory.schema {
        return Err(CommandError::new(
            "janusgraph-import-schema-mismatch",
            "The target JanusGraph schema does not exactly match the transfer schema. Create or select a compatible empty graph before importing.",
        ));
    }

    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    let endpoint_url = endpoint.url("/gremlin");
    let request = websocket_request(connection, &endpoint, &endpoint_url, "", None, false);
    let session_id = format!("datapad-transfer-{:032x}", rand::rng().random::<u128>());
    let mut session = GremlinWebSocketSession::connect(&request, session_id)
        .await
        .map_err(|error| janusgraph_websocket_error(&endpoint_url, error))?;
    let operation = import_graph_session(&mut session, path).await;
    match operation {
        Ok((vertices, edges)) => {
            session.close().await;
            Ok(
                json!({"workflow":"janusgraph.graph.import","format":"graphson3","vertexCount":vertices,"edgeCount":edges,"validatedVertexCount":inventory.vertices,"validatedEdgeCount":inventory.edges}),
            )
        }
        Err(error) => {
            let _ = session
                .execute(
                    "graph.tx().rollback(); transferVertices = null; true",
                    &Map::new(),
                    false,
                )
                .await;
            session.close().await;
            Err(error)
        }
    }
}

async fn import_graph_session(
    session: &mut GremlinWebSocketSession,
    path: &Path,
) -> Result<(u64, u64), CommandError> {
    session
        .execute("transferVertices = [:]; true", &Map::new(), false)
        .await?;
    let file = File::open(path).await.map_err(|_| {
        file_error(
            "janusgraph-import-file-failed",
            "JanusGraph import could not open the selected local file.",
        )
    })?;
    let mut lines = BufReader::new(file).lines();
    let _ = next_record(&mut lines).await?;
    let _ = next_record(&mut lines).await?;
    let mut vertices = Vec::with_capacity(IMPORT_BATCH_SIZE);
    let mut edges = Vec::with_capacity(IMPORT_BATCH_SIZE);
    let mut vertex_bytes = 0_usize;
    let mut edge_bytes = 0_usize;
    let mut vertex_count = 0_u64;
    let mut edge_count = 0_u64;
    while let Some(record) = next_record(&mut lines).await? {
        let kind = record
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let graphson = record
            .get("graphson")
            .cloned()
            .ok_or_else(|| record_error("JanusGraph transfer record has no GraphSON value."))?;
        let graphson_bytes = serde_json::to_vec(&graphson)
            .map_err(|_| record_error("JanusGraph GraphSON record cannot be encoded."))?
            .len();
        if graphson_bytes > MAX_IMPORT_BATCH_BYTES {
            return Err(record_error(
                "A JanusGraph GraphSON record exceeds the connected server's safe request-frame size.",
            ));
        }
        match kind {
            "vertex" => {
                if !vertices.is_empty()
                    && (vertices.len() == IMPORT_BATCH_SIZE
                        || vertex_bytes + graphson_bytes > MAX_IMPORT_BATCH_BYTES)
                {
                    vertex_count +=
                        import_batch(session, IMPORT_VERTICES_QUERY, &mut vertices).await?;
                    vertex_bytes = 0;
                }
                vertices.push(graphson);
                vertex_bytes += graphson_bytes;
            }
            "edge" => {
                if !vertices.is_empty() {
                    vertex_count +=
                        import_batch(session, IMPORT_VERTICES_QUERY, &mut vertices).await?;
                    vertex_bytes = 0;
                }
                if !edges.is_empty()
                    && (edges.len() == IMPORT_BATCH_SIZE
                        || edge_bytes + graphson_bytes > MAX_IMPORT_BATCH_BYTES)
                {
                    edge_count += import_batch(session, IMPORT_EDGES_QUERY, &mut edges).await?;
                    edge_bytes = 0;
                }
                edges.push(graphson);
                edge_bytes += graphson_bytes;
            }
            _ => return Err(record_error("JanusGraph transfer record kind is invalid.")),
        }
    }
    if !vertices.is_empty() {
        vertex_count += import_batch(session, IMPORT_VERTICES_QUERY, &mut vertices).await?;
    }
    if !edges.is_empty() {
        edge_count += import_batch(session, IMPORT_EDGES_QUERY, &mut edges).await?;
    }
    session
        .execute(
            "graph.tx().commit(); transferVertices = null; true",
            &Map::new(),
            false,
        )
        .await?;
    Ok((vertex_count, edge_count))
}

async fn import_batch(
    session: &mut GremlinWebSocketSession,
    query: &str,
    values: &mut Vec<Value>,
) -> Result<u64, CommandError> {
    let expected = values.len() as u64;
    let graphson_list = json!({"@type":"g:List","@value":std::mem::take(values)});
    let bindings = Map::from_iter([("rows".into(), graphson_list)]);
    let response = session.execute(query, &bindings, false).await?;
    let actual = decoded_count(&response)?;
    if actual != expected {
        return Err(record_error(
            "JanusGraph did not acknowledge the complete import batch.",
        ));
    }
    Ok(actual)
}

async fn validate_import_file(path: &Path) -> Result<ImportInventory, CommandError> {
    let file = File::open(path).await.map_err(|_| {
        file_error(
            "janusgraph-import-file-failed",
            "JanusGraph import could not open the selected local file.",
        )
    })?;
    let mut lines = BufReader::new(file).lines();
    let header = next_record(&mut lines)
        .await?
        .ok_or_else(|| record_error("JanusGraph transfer file is empty."))?;
    if header.get("format").and_then(Value::as_str) != Some("datapadplusplus-janusgraph-graphson")
        || header.get("version").and_then(Value::as_u64) != Some(TRANSFER_VERSION)
        || header.get("graphson").and_then(Value::as_str) != Some("3.0")
    {
        return Err(record_error(
            "JanusGraph transfer header or GraphSON version is unsupported.",
        ));
    }
    let schema_record = next_record(&mut lines)
        .await?
        .ok_or_else(|| record_error("JanusGraph transfer schema manifest is missing."))?;
    if schema_record.get("kind").and_then(Value::as_str) != Some("schema") {
        return Err(record_error(
            "JanusGraph transfer schema manifest is invalid.",
        ));
    }
    let schema = schema_record
        .get("graphson")
        .cloned()
        .ok_or_else(|| record_error("JanusGraph transfer schema metadata is missing."))?;
    let mut vertices = 0_u64;
    let mut edges = 0_u64;
    let mut saw_edge = false;
    while let Some(record) = next_record(&mut lines).await? {
        if record.get("graphson").is_none() {
            return Err(record_error(
                "JanusGraph transfer record has no GraphSON value.",
            ));
        }
        match record.get("kind").and_then(Value::as_str) {
            Some("vertex") if !saw_edge => vertices += 1,
            Some("edge") => {
                saw_edge = true;
                edges += 1;
            }
            Some("vertex") => {
                return Err(record_error(
                    "JanusGraph vertices must appear before edges in the transfer file.",
                ))
            }
            _ => return Err(record_error("JanusGraph transfer record kind is invalid.")),
        }
    }
    Ok(ImportInventory {
        schema,
        vertices,
        edges,
    })
}

async fn transfer_query(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
    bindings: &Map<String, Value>,
) -> Result<Value, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    let endpoint_url = endpoint.url("/gremlin");
    execute_gremlin_websocket(websocket_request(
        connection,
        &endpoint,
        &endpoint_url,
        gremlin,
        Some(bindings),
        true,
    ))
    .await
    .map_err(|error| janusgraph_websocket_error(&endpoint_url, error))
}

fn websocket_request<'a>(
    connection: &'a ResolvedConnectionProfile,
    endpoint: &'a JanusGraphEndpoint,
    endpoint_url: &'a str,
    gremlin: &'a str,
    bindings: Option<&'a Map<String, Value>>,
    preserve_graphson_types: bool,
) -> GremlinWebSocketRequest<'a> {
    let options = connection.graph_options.as_ref();
    GremlinWebSocketRequest {
        endpoint: endpoint_url,
        gremlin,
        traversal_source: &endpoint.traversal_source,
        username: options
            .and_then(|value| value.username.as_deref())
            .or(connection.username.as_deref()),
        password: connection.password.as_deref(),
        graphson: GremlinGraphSon::V3,
        bindings,
        preserve_graphson_types,
        timeout_ms: options
            .and_then(|value| value.query_timeout_ms)
            .unwrap_or(30_000),
        send_basic_header: false,
        verify_certificates: options
            .and_then(|value| value.verify_certificates)
            .unwrap_or(true),
        ca_certificate_path: options.and_then(|value| value.ca_certificate_path.as_deref()),
        client_certificate_path: options.and_then(|value| value.client_certificate_path.as_deref()),
        client_key_path: options.and_then(|value| value.client_key_path.as_deref()),
    }
}

fn response_items(value: &Value) -> Vec<Value> {
    value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn decoded_count(value: &Value) -> Result<u64, CommandError> {
    value
        .pointer("/result/data/0")
        .and_then(Value::as_u64)
        .ok_or_else(|| transfer_error("JanusGraph did not return an authoritative count."))
}

async fn write_json_line(output: &mut BufWriter<File>, value: &Value) -> Result<(), CommandError> {
    let mut encoded = serde_json::to_vec(value).map_err(|_| {
        file_error(
            "janusgraph-export-value-invalid",
            "JanusGraph returned a GraphSON value that could not be encoded.",
        )
    })?;
    encoded.push(b'\n');
    output.write_all(&encoded).await.map_err(|_| {
        file_error(
            "janusgraph-export-file-failed",
            "JanusGraph export could not write the selected local file.",
        )
    })
}

async fn next_record(
    lines: &mut tokio::io::Lines<BufReader<File>>,
) -> Result<Option<Value>, CommandError> {
    let Some(line) = lines.next_line().await.map_err(|_| {
        file_error(
            "janusgraph-import-file-failed",
            "JanusGraph import could not read the selected local file.",
        )
    })?
    else {
        return Ok(None);
    };
    if line.len() > MAX_LINE_BYTES {
        return Err(record_error(
            "A JanusGraph GraphSON record exceeds the 64 MiB safety limit.",
        ));
    }
    serde_json::from_str(&line)
        .map(Some)
        .map_err(|_| record_error("JanusGraph transfer contains invalid JSON Lines."))
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
                .get(object_key)
                .and_then(Value::as_object)
                .and_then(|value| {
                    value
                        .get("path")
                        .or_else(|| value.get("filePath"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "janusgraph-transfer-path-missing",
                "JanusGraph transfer requires a backend-selected local file.",
            )
        })?;
    if value.contains('\0') {
        return Err(CommandError::new(
            "janusgraph-transfer-path-invalid",
            "JanusGraph transfer received an invalid local file selection.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "janusgraph-transfer-path-invalid",
            "JanusGraph transfer requires an absolute local file selection.",
        ));
    }
    Ok(path)
}

fn validate_export_path(path: &Path) -> Result<(), CommandError> {
    if path.exists() {
        return Err(CommandError::new(
            "janusgraph-export-target-exists",
            "JanusGraph export will not overwrite an existing file.",
        ));
    }
    if !path.parent().is_some_and(Path::exists) {
        return Err(CommandError::new(
            "janusgraph-export-parent-missing",
            "The selected JanusGraph export folder does not exist.",
        ));
    }
    Ok(())
}

fn validate_import_path(path: &Path) -> Result<(), CommandError> {
    if !path.is_file() {
        return Err(CommandError::new(
            "janusgraph-import-source-missing",
            "The selected JanusGraph import file does not exist.",
        ));
    }
    Ok(())
}

fn require_fail_policy(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    if parameter_string(request, "conflictPolicy")
        .as_deref()
        .unwrap_or("fail")
        != "fail"
    {
        return Err(CommandError::new(
            "janusgraph-import-conflict-policy-invalid",
            "JanusGraph import supports only fail-on-conflict behavior.",
        ));
    }
    Ok(())
}

fn partial_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(format!(".partial-{:016x}", rand::rng().random::<u64>()));
    PathBuf::from(value)
}

fn file_error(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

fn record_error(message: &str) -> CommandError {
    CommandError::new("janusgraph-import-record-invalid", message)
}

fn transfer_error(message: &str) -> CommandError {
    CommandError::new("janusgraph-transfer-response-invalid", message)
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
#[path = "../../../../tests/unit/adapters/datastores/janusgraph/import_export_tests.rs"]
mod tests;
