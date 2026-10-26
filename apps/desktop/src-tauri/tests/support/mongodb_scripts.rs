use super::*;
use datapadplusplus_desktop_lib::domain::models::{CancelExecutionRequest, ScriptTimeoutPolicy};
use std::{sync::Arc, time::Duration};

pub async fn validate_scripts(
    connection: &ResolvedConnectionProfile,
    collection: &str,
) -> Result<(), CommandError> {
    // Only the disposable collection created by this fixture is inspected/compacted.
    let source = format!(
        r#"const names = db.getCollectionNames();
const stats = db.runCommand({{collStats: {collection:?}}});
const compact = db.runCommand({{compact: {collection:?}, dryRun: true, force: true}});
print(`Collections: ${{names.length}}`);
({{ names, count: stats.count, compactOk: compact.ok }})"#
    );
    let mut request = execution_request(&connection.id, "env-dev", "javascript", &source);
    request.execution_input_mode = Some("script".into());
    request.script_text = Some(source);
    request.script_timeout = ScriptTimeoutPolicy::Custom { seconds: 21_600 };
    request.row_limit = Some(1);
    let progress = Arc::new(std::sync::Mutex::new(Vec::new()));
    let collected = progress.clone();
    request.script_progress = Some(Arc::new(move |event| collected.lock().unwrap().push(event)));
    let result = adapters::execute(connection, &request, Vec::new()).await?;
    let batch = result
        .payloads
        .iter()
        .find(|payload| payload["renderer"] == "batch")
        .unwrap();
    let value = &batch["sections"].as_array().unwrap().last().unwrap()["payloads"][0]["value"];
    assert!(
        value["names"].as_array().unwrap().len() > 1,
        "metadata must not inherit the result batch size"
    );
    assert_eq!(value["count"], 1);
    assert_eq!(value["compactOk"], 1.0);
    {
        let events = progress.lock().unwrap();
        assert!(events.iter().any(|event| event["status"] == "running"));
        assert!(events.iter().any(|event| event["status"] == "completed"));
    }

    request.query_text = "db.runCommand({ping: 1}); while (true) {}".into();
    request.script_text = Some(request.query_text.clone());
    request.script_progress = None;
    request.script_timeout = ScriptTimeoutPolicy::Custom { seconds: 1 };
    let error = adapters::execute(connection, &request, Vec::new())
        .await
        .err()
        .expect("the script must time out");
    assert_eq!(error.code, "mongodb-script-timeout");

    request.execution_id = Some(format!("fixture-script-cancel-{}", std::process::id()));
    request.script_timeout = ScriptTimeoutPolicy::Unlimited;
    let ready = Arc::new(tokio::sync::Notify::new());
    let signal = ready.clone();
    request.script_progress = Some(Arc::new(move |event| {
        if event["status"] == "completed" {
            signal.notify_one();
        }
    }));
    let cancellation = async {
        ready.notified().await;
        adapters::cancel(
            connection,
            &CancelExecutionRequest {
                execution_id: request.execution_id.clone().unwrap(),
                tab_id: Some(request.tab_id.clone()),
            },
        )
        .await
    };
    let (execution, cancelled) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(
            adapters::execute(connection, &request, Vec::new()),
            cancellation
        )
    })
    .await
    .expect("No timeout must still permit prompt cancellation");
    assert!(cancelled?.ok);
    assert_eq!(
        execution.err().expect("the script must be cancelled").code,
        "execution-cancelled"
    );
    Ok(())
}
