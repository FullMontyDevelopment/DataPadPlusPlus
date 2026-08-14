use super::*;

#[test]
fn context_lines_include_process_correlation() {
    let line = format_context_line("warning", "renderer", "event=unhandled-rejection");

    assert!(line.contains("[WARN] renderer:"));
    assert!(line.contains("session="));
    assert!(line.contains("pid="));
    assert!(line.contains("event=unhandled-rejection"));
}

#[test]
fn diagnostic_tokens_reject_log_structure_characters() {
    assert_eq!(
        diagnostic_token("window ready\r\nsecret=value", "unknown"),
        "windowreadysecretvalue"
    );
    assert_eq!(diagnostic_token("***", "unknown"), "unknown");
}
