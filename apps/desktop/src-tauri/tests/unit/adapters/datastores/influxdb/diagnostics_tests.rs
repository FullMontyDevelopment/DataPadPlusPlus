use serde_json::json;

use super::influxdb_series_row_count;

#[test]
fn influxdb_series_row_count_sums_values() {
    let value = json!({
        "results": [{
            "series": [
                { "values": [["cpu"], ["mem"]] },
                { "values": [["disk"]] }
            ]
        }]
    });

    assert_eq!(influxdb_series_row_count(Some(&value)), 3);
    assert_eq!(influxdb_series_row_count(None), 0);
}
