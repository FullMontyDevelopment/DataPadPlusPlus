use crate::domain::error::CommandError;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

static APPROVALS: LazyLock<Mutex<HashMap<String, (String, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn issue(binding: String) -> Result<String, CommandError> {
    let mut pending = APPROVALS.lock().map_err(|_| unavailable())?;
    pending.retain(|_, (_, created)| created.elapsed() < Duration::from_secs(600));
    if pending.len() >= 512 {
        return Err(unavailable());
    }
    let mut nonce = [0_u8; 32];
    rand::fill(&mut nonce);
    let id = nonce
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    pending.insert(id.clone(), (binding, Instant::now()));
    Ok(id)
}

pub(super) fn consume(id: &str, binding: &str) -> Result<(), CommandError> {
    let entry = APPROVALS.lock().map_err(|_| unavailable())?.remove(id);
    if entry.is_some_and(|(expected, created)| {
        expected == binding && created.elapsed() < Duration::from_secs(600)
    }) {
        return Ok(());
    }
    Err(CommandError::new("execution-approval-stale", "This approval expired, was already used, or its execution context changed. Run again to review the current request."))
}

fn unavailable() -> CommandError {
    CommandError::new(
        "execution-approval-unavailable",
        "Execution approval is unavailable. Close pending confirmations and try again.",
    )
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/execution_approvals_tests.rs"]
mod tests;
