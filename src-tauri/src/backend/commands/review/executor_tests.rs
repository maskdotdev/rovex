use super::executor::is_transient_chunk_error;

#[test]
fn classifies_transient_errors() {
    assert!(is_transient_chunk_error("429 Too Many Requests"));
    assert!(is_transient_chunk_error("request timed out"));
    assert!(is_transient_chunk_error("connection refused"));
    assert!(!is_transient_chunk_error("invalid request payload"));
}
