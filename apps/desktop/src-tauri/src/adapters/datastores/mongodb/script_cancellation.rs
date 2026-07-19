use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use tokio_util::sync::CancellationToken;

static SCRIPT_EXECUTIONS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) struct MongoScriptCancellationGuard {
    execution_id: Option<String>,
    token: CancellationToken,
}

impl MongoScriptCancellationGuard {
    pub(super) fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for MongoScriptCancellationGuard {
    fn drop(&mut self) {
        if let Some(execution_id) = &self.execution_id {
            if let Ok(mut executions) = SCRIPT_EXECUTIONS.lock() {
                executions.remove(execution_id);
            }
        }
    }
}

pub(super) fn register(execution_id: Option<&str>) -> MongoScriptCancellationGuard {
    let token = CancellationToken::new();
    let execution_id = execution_id.map(str::to_string);
    if let Some(execution_id) = &execution_id {
        if let Ok(mut executions) = SCRIPT_EXECUTIONS.lock() {
            executions.insert(execution_id.clone(), token.clone());
        }
    }
    MongoScriptCancellationGuard {
        execution_id,
        token,
    }
}

pub(super) fn cancel(execution_id: &str) -> bool {
    let token = SCRIPT_EXECUTIONS
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
