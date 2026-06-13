use super::*;

#[test]
fn bounded_items_returns_visible_items_and_truncation_signal() {
    let bounded = bounded_items(0..101, 100);

    assert_eq!(bounded.visible.len(), 100);
    assert_eq!(bounded.visible.first(), Some(&0));
    assert_eq!(bounded.visible.last(), Some(&99));
    assert!(bounded.truncated);
}

#[test]
fn bounded_items_does_not_mark_exact_limit_as_truncated() {
    let bounded = bounded_items(["a", "b"], 2);

    assert_eq!(bounded.visible, vec!["a", "b"]);
    assert!(!bounded.truncated);
}
