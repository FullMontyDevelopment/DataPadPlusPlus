use std::collections::BTreeMap;

use serde_json::{json, Value};

pub(crate) fn payload_table(columns: Vec<String>, rows: Vec<Vec<String>>) -> Value {
    json!({
        "renderer": "table",
        "columns": columns,
        "rows": rows,
    })
}

pub(crate) fn payload_json(value: Value) -> Value {
    json!({
        "renderer": "json",
        "value": value,
    })
}

pub(crate) fn payload_raw(text: String) -> Value {
    json!({
        "renderer": "raw",
        "text": text,
    })
}

pub(crate) fn payload_resp(text: String) -> Value {
    json!({
        "renderer": "resp",
        "text": text,
    })
}

pub(crate) fn payload_batch(sections: Vec<Value>, summary: String) -> Value {
    json!({
        "renderer": "batch",
        "sections": sections,
        "summary": summary,
    })
}

pub(crate) struct BatchSectionPayload {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) statement: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) duration_ms: Option<u64>,
    pub(crate) row_count: Option<usize>,
    pub(crate) default_renderer: String,
    pub(crate) renderer_modes: Vec<String>,
    pub(crate) payloads: Vec<Value>,
    pub(crate) notices: Vec<Value>,
}

pub(crate) fn batch_section(section: BatchSectionPayload) -> Value {
    json!({
        "id": section.id,
        "label": section.label,
        "statement": section.statement,
        "status": section.status,
        "durationMs": section.duration_ms,
        "rowCount": section.row_count,
        "defaultRenderer": section.default_renderer,
        "rendererModes": section.renderer_modes,
        "payloads": section.payloads,
        "notices": section.notices,
    })
}

pub(crate) fn payload_document(documents: Value) -> Value {
    json!({
        "renderer": "document",
        "documents": documents,
    })
}

pub(crate) fn payload_keyvalue(
    entries: BTreeMap<String, String>,
    ttl: Option<String>,
    memory: Option<String>,
) -> Value {
    json!({
        "renderer": "keyvalue",
        "entries": entries,
        "ttl": ttl,
        "memoryUsage": memory,
    })
}

pub(crate) fn payload_plan(format: &str, value: Value, summary: &str) -> Value {
    json!({
        "renderer": "plan",
        "format": format,
        "value": value,
        "summary": summary,
    })
}

pub(crate) fn payload_profile(summary: &str, stages: Value) -> Value {
    json!({
        "renderer": "profile",
        "summary": summary,
        "stages": stages,
    })
}

pub(crate) fn payload_metrics(metrics: Value) -> Value {
    json!({
        "renderer": "metrics",
        "metrics": metrics,
    })
}

pub(crate) fn payload_series(series: Value) -> Value {
    json!({
        "renderer": "series",
        "series": series,
    })
}

pub(crate) fn payload_chart(chart_type: &str, series: Value, x_axis: &str, y_axis: &str) -> Value {
    json!({
        "renderer": "chart",
        "chartType": chart_type,
        "xAxis": x_axis,
        "yAxis": y_axis,
        "series": series,
    })
}

pub(crate) fn metric(name: &str, value: f64, unit: &str, labels: Value) -> Value {
    json!({
        "name": name,
        "value": value,
        "unit": unit,
        "labels": labels,
    })
}

pub(crate) fn payload_metric_series(metrics: &[Value], timestamp: &str) -> Value {
    payload_series(json!(metrics
        .iter()
        .filter_map(|metric| {
            let name = metric.get("name")?.as_str()?.to_string();
            let value = metric.get("value")?.as_f64()?;
            let unit = metric
                .get("unit")
                .and_then(Value::as_str)
                .map(str::to_string);
            let labels = metric.get("labels").cloned();
            Some(json!({
                "name": name,
                "unit": unit,
                "points": [
                    {
                        "timestamp": timestamp,
                        "value": value,
                        "labels": labels,
                    }
                ]
            }))
        })
        .collect::<Vec<Value>>()))
}

pub(crate) fn payload_metric_bar_chart(metrics: &[Value], title: &str) -> Value {
    let points = metrics
        .iter()
        .filter_map(|metric| {
            let name = metric.get("name")?.as_str()?;
            let value = metric.get("value")?.as_f64()?;
            Some(json!({
                "x": name.rsplit('.').next().unwrap_or(name),
                "y": value,
            }))
        })
        .collect::<Vec<Value>>();

    payload_chart(
        "bar",
        json!([
            {
                "name": title,
                "points": points,
            }
        ]),
        "Metric",
        "Value",
    )
}

pub(crate) fn payload_search_hits(total: u64, hits: Value, aggregations: Value) -> Value {
    json!({
        "renderer": "searchHits",
        "total": total,
        "hits": hits,
        "aggregations": aggregations,
    })
}

pub(crate) fn payload_graph(nodes: Value, edges: Value) -> Value {
    json!({
        "renderer": "graph",
        "nodes": nodes,
        "edges": edges,
    })
}

pub(crate) fn payload_graph_with_metadata(nodes: Value, edges: Value, metadata: Value) -> Value {
    let node_count = metadata
        .get("nodeCount")
        .and_then(Value::as_u64)
        .or_else(|| nodes.as_array().map(|items| items.len() as u64))
        .unwrap_or_default();
    let edge_count = metadata
        .get("edgeCount")
        .and_then(Value::as_u64)
        .or_else(|| edges.as_array().map(|items| items.len() as u64))
        .unwrap_or_default();
    let truncated = metadata
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or_default();
    let warnings = metadata
        .get("warnings")
        .cloned()
        .unwrap_or_else(|| json!([]));
    json!({
        "renderer": "graph",
        "nodes": nodes,
        "edges": edges,
        "nodeCount": node_count,
        "edgeCount": edge_count,
        "visualNodeCap": metadata.get("visualNodeCap").cloned(),
        "visualEdgeCap": metadata.get("visualEdgeCap").cloned(),
        "truncated": truncated,
        "warnings": warnings,
        "metadata": metadata,
    })
}

pub(crate) fn payload_cost_estimate(details: Value) -> Value {
    let currency = details
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("USD");
    let estimated_bytes = details
        .get("estimatedBytes")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let estimated_credits = details
        .get("estimatedCredits")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let estimated_cost = details
        .get("estimatedCost")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    json!({
        "renderer": "costEstimate",
        "currency": currency,
        "estimatedBytes": estimated_bytes,
        "estimatedCredits": estimated_credits,
        "estimatedCost": estimated_cost,
        "details": details,
    })
}
