use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use tokio_util::sync::CancellationToken;

static COSMOSDB_EXECUTIONS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) struct CosmosDbCancellationGuard {
    execution_id: Option<String>,
    token: CancellationToken,
}

impl CosmosDbCancellationGuard {
    pub(super) fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for CosmosDbCancellationGuard {
    fn drop(&mut self) {
        let Some(execution_id) = &self.execution_id else {
            return;
        };
        if let Ok(mut executions) = COSMOSDB_EXECUTIONS.lock() {
            executions.remove(execution_id);
        }
    }
}

pub(super) fn register(execution_id: Option<&str>) -> CosmosDbCancellationGuard {
    let token = CancellationToken::new();
    let execution_id = execution_id.map(str::to_string);
    if let Some(execution_id) = &execution_id {
        if let Ok(mut executions) = COSMOSDB_EXECUTIONS.lock() {
            executions.insert(execution_id.clone(), token.clone());
        }
    }
    CosmosDbCancellationGuard {
        execution_id,
        token,
    }
}

pub(super) fn cancel(execution_id: &str) -> bool {
    let token = COSMOSDB_EXECUTIONS
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
