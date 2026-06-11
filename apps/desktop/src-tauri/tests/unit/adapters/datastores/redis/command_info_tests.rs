use super::command_info_payloads;
use serde_json::json;

#[test]
fn redis_command_info_payloads_normalize_resp2_arrays() {
    let payloads = command_info_payloads(
        "COMMAND INFO GET FT.SEARCH",
        &json!([
            [
                "get",
                2,
                ["readonly", "fast"],
                1,
                1,
                1,
                ["@read", "@string", "@fast"],
                [],
                [],
                []
            ],
            [
                "ft.search",
                -3,
                ["readonly"],
                1,
                1,
                1,
                ["@search"],
                ["nondeterministic_output"],
                [],
                []
            ]
        ]),
    )
    .expect("command metadata payloads");

    assert_eq!(payloads[0]["renderer"], "table");
    assert_eq!(payloads[0]["rows"][0][0], "GET");
    assert_eq!(
        payloads[1]["value"]["commandMetadata"][1]["name"],
        "FT.SEARCH"
    );
    assert_eq!(
        payloads[1]["value"]["commandMetadata"][1]["syntax"],
        "FT.SEARCH <arg> [arg ...]"
    );
    assert_eq!(
        payloads[1]["value"]["commandMetadata"][1]["firstKeyPosition"],
        1
    );
}

#[test]
fn redis_command_info_payloads_normalize_resp3_maps() {
    let payloads = command_info_payloads(
        "COMMAND",
        &json!({
            "latency": {
                "arity": -2,
                "flags": ["readonly"],
                "aclCategories": ["@admin", "@slow"],
                "firstKeyPosition": 0
            }
        }),
    )
    .expect("command metadata payloads");

    assert_eq!(
        payloads[1]["value"]["commandMetadata"][0]["name"],
        "LATENCY"
    );
    assert_eq!(
        payloads[1]["value"]["commandMetadata"][0]["syntax"],
        "LATENCY <arg> [arg ...]"
    );
}
