use super::*;

#[test]
fn mongodb_page_documents_cap_overfetched_page_to_requested_size() {
    let documents = (0..101)
        .map(|index| doc! { "_id": index })
        .collect::<Vec<_>>();

    let bounded = bounded_mongodb_page_documents(&documents, 100);

    assert_eq!(bounded.documents.len(), 100);
    assert!(bounded.has_more);
}
