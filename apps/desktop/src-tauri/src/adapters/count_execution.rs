use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use tokio_util::sync::CancellationToken;

use crate::domain::error::CommandError;

static COUNT_EXECUTIONS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) struct CountExecutionGuard {
    execution_id: Option<String>,
    token: CancellationToken,
}

impl CountExecutionGuard {
    pub(crate) fn check(&self) -> Result<(), CommandError> {
        if self.token.is_cancelled() {
            Err(CommandError::new(
                "execution-cancelled",
                "The Count operation was cancelled before it completed.",
            ))
        } else {
            Ok(())
        }
    }
}

impl Drop for CountExecutionGuard {
    fn drop(&mut self) {
        let Some(execution_id) = &self.execution_id else {
            return;
        };
        if let Ok(mut executions) = COUNT_EXECUTIONS.lock() {
            executions.remove(execution_id);
        }
    }
}

pub(crate) fn register_count_execution(execution_id: Option<&str>) -> CountExecutionGuard {
    let token = CancellationToken::new();
    let execution_id = execution_id.map(str::to_string);
    if let Some(execution_id) = &execution_id {
        if let Ok(mut executions) = COUNT_EXECUTIONS.lock() {
            executions.insert(execution_id.clone(), token.clone());
        }
    }
    CountExecutionGuard {
        execution_id,
        token,
    }
}

pub(crate) fn cancel_count_execution(execution_id: &str) -> bool {
    let token = COUNT_EXECUTIONS
        .lock()
        .ok()
        .and_then(|executions| executions.get(execution_id).cloned());
    if let Some(token) = token {
        token.cancel();
        true
    } else {
        false
    }
}

#[cfg(test)]
#[path = "../../tests/unit/adapters/count_execution_tests.rs"]
mod tests;
