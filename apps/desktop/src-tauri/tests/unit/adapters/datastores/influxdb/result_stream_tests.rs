use super::*;

#[derive(Default)]
struct Sink(Vec<Value>);
impl ResultRowSink for Sink {
    fn row(&mut self, value: Value) -> Result<bool, CommandError> {
        self.0.push(value);
        Ok(true)
    }
}

#[test]
fn chunks_preserve_points_native_values_tags_and_measurement_without_ui_limits() {
    let mut decoder = ChunkDecoder::default();
    let mut sink = Sink::default();
    for (start, end) in [(0, 500), (500, 1000), (1000, 1501)] {
        let chunk = json!({"results":[{"statement_id":0,"series":[{
            "name":"metrics","tags":{"host":"λ"},
            "columns":["time","id","nullable","text","precise"],
            "values":(start..end).map(|id| json!([id, id, null, "line\nλ", 9007199254740993_i64])).collect::<Vec<_>>(),
            "partial":end < 1501
        }]}]});
        assert!(decoder
            .accept(&serde_json::to_vec(&chunk).unwrap(), &mut sink)
            .unwrap());
    }
    decoder.finish().unwrap();
    assert_eq!(sink.0.len(), 1501);
    assert_eq!(
        sink.0[1500],
        json!({"measurement":"metrics","tags":{"host":"λ"},"fields":{
            "time":1500,"id":1500,"nullable":null,"text":"line\nλ","precise":9007199254740993_i64
        }})
    );
}

#[test]
fn empty_chunks_are_not_completion_and_partial_final_responses_fail() {
    let mut decoder = ChunkDecoder::default();
    let mut sink = Sink::default();
    decoder
        .accept(
            br#"{"results":[{"statement_id":0,"partial":true}]}"#,
            &mut sink,
        )
        .unwrap();
    assert!(decoder.finish().is_err());
    let mut decoder = ChunkDecoder::default();
    decoder
        .accept(br#"{"results":[{"statement_id":0}]}"#, &mut sink)
        .unwrap();
    decoder.finish().unwrap();
    assert!(sink.0.is_empty());
}

#[test]
fn malformed_or_error_chunks_never_report_success_or_expose_provider_values() {
    for bytes in [
        br#"{"results":[{"error":"sensitive query"}]}"#.as_slice(),
        br#"{"results":[{"statement_id":0,"series":[{"name":"x","columns":["a"],"values":[[1,2]]}]}]}"#,
        br#"{"results":[{"statement_id":0,"series":[{"name":"x","columns":["a","a"],"values":[[1,2]]}]}]}"#,
        br#"{"results":[{"statement_id":0}"#,
        br#"{"results":[]}"#,
    ] {
        let error = ChunkDecoder::default().accept(bytes, &mut Sink::default()).unwrap_err();
        assert!(!error.message.contains("sensitive query"));
    }
}
