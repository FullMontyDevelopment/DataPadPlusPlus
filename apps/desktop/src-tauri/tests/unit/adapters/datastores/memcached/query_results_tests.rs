use super::{
    get_response_values, item_rows, memcached_get_result, memcached_stats_result, slab_rows,
    stats_entries,
};

#[test]
fn memcached_get_response_parses_multiple_values_and_cas() {
    let values = get_response_values(
        "VALUE account:1 0 5 42\r\nalpha\r\nVALUE account:2 7 4\r\nbeta\r\nEND\r\n",
    );

    assert_eq!(values.len(), 2);
    assert_eq!(values[0].key, "account:1");
    assert_eq!(values[0].cas.as_deref(), Some("42"));
    assert_eq!(values[0].value, "alpha");
    assert_eq!(values[1].flags, "7");
    assert_eq!(values[1].cas, None);
}

#[test]
fn memcached_get_result_reports_misses_without_raw_only_fallback() {
    let (payloads, summary) =
        memcached_get_result("VALUE hit 0 2\r\nok\r\nEND\r\n", &["hit", "miss"]);
    let table = payloads
        .iter()
        .find(|payload| payload["renderer"] == "table")
        .expect("table payload");
    let json = payloads
        .iter()
        .find(|payload| payload["renderer"] == "json")
        .expect("json payload");

    assert_eq!(summary, "Memcached returned 1 of 2 requested key(s).");
    assert_eq!(table["columns"][0], "key");
    assert_eq!(json["value"]["missedKeys"][0], "miss");
}

#[test]
fn memcached_slab_stats_render_class_table() {
    let raw = "STAT 1:chunk_size 96\r\nSTAT 1:chunks_per_page 10923\r\nSTAT 1:total_pages 1\r\nSTAT 1:used_chunks 10\r\nSTAT 1:free_chunks 2\r\nEND\r\n";
    let entries = stats_entries(raw);

    let rows = slab_rows(&entries);
    let (payloads, summary) = memcached_stats_result(Some("slabs"), raw);

    assert_eq!(rows[0][0], "1");
    assert_eq!(rows[0][1], "96");
    assert_eq!(rows[0][5], "1.0 MB");
    assert_eq!(summary, "Memcached slab stats returned 1 class(es).");
    assert!(payloads
        .iter()
        .any(|payload| payload["renderer"] == "table"));
}

#[test]
fn memcached_item_stats_render_class_table() {
    let raw = "STAT items:2:number 9004\r\nSTAT items:2:age 18\r\nSTAT items:2:evicted 7\r\nSTAT items:2:outofmemory 0\r\nSTAT items:2:reclaimed 481\r\nEND\r\n";
    let entries = stats_entries(raw);

    let rows = item_rows(&entries);
    let (_, summary) = memcached_stats_result(Some("items"), raw);

    assert_eq!(rows[0], vec!["2", "9004", "18", "7", "0", "481"]);
    assert_eq!(summary, "Memcached item stats returned 1 class(es).");
}

#[test]
fn memcached_settings_stats_render_settings_table() {
    let (payloads, summary) =
        memcached_stats_result(Some("settings"), "STAT maxbytes 268435456\r\nEND\r\n");
    let table = payloads
        .iter()
        .find(|payload| payload["renderer"] == "table")
        .expect("table payload");

    assert_eq!(summary, "Memcached settings returned 1 value(s).");
    assert_eq!(table["rows"][0][0], "maxbytes");
    assert_eq!(table["rows"][0][1], "268435456");
}
