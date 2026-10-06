use super::*;

fn context() -> AuthContext {
    AuthContext {
        key: "unit-binding".into(),
        connection_id: "unit-connection".into(),
        environment_id: "unit-environment".into(),
        tenant_id: "unit-tenant".into(),
        client_id: "unit-client".into(),
        cache_directory: PathBuf::new(),
        epoch: EPOCH.load(Ordering::SeqCst),
        versions: versions("unit-connection", "unit-environment"),
    }
}

fn fake_session(source: &str) -> Session {
    // Fixtures never contain real identity data. Production helper launch has no arguments.
    let mut command = Command::new("node");
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .args(["-e", source])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let input = child.stdin.take().unwrap();
    let output = BufReader::new(child.stdout.take().unwrap());
    Session {
        context: context(),
        interactive: AtomicBool::new(false),
        stop: CancellationToken::new(),
        process: AsyncMutex::new(Some(Process {
            _child: child,
            input,
            output,
        })),
    }
}

#[tokio::test]
async fn canceled_ipc_discards_the_process_and_never_reuses_a_late_response() {
    let session = fake_session("process.stdin.on('data',()=>{});setInterval(()=>{},1000)");
    let token = session.stop.clone();
    let cancel = async {
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        token.cancel();
    };
    let (response, _) = tokio::join!(exchange(&session, "sign-in", false), cancel);
    assert_eq!(response.unwrap_err().code, "sqlserver-sign-in-canceled");
    assert!(session.process.lock().await.is_none());
}

#[tokio::test]
async fn outer_query_timeout_also_discards_inflight_ipc() {
    let session = fake_session("process.stdin.on('data',()=>{});setInterval(()=>{},1000)");
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(30),
        exchange(&session, "token", false)
    )
    .await
    .is_err());
    assert!(session.process.lock().await.is_none());
}

#[tokio::test]
async fn parallel_silent_acquisitions_serialize_without_starting_interactive_signin() {
    let session = fake_session("require('readline').createInterface({input:process.stdin}).on('line',s=>{const r=JSON.parse(s);console.log(JSON.stringify(r.operation==='token'?{accessToken:'unit-token'}:{error:'invalid-request'}));})");
    let (first, second) = tokio::join!(
        exchange(&session, "token", false),
        exchange(&session, "token", false)
    );
    assert_eq!(first.unwrap()["accessToken"], "unit-token");
    assert_eq!(second.unwrap()["accessToken"], "unit-token");
}

#[tokio::test]
async fn background_acquisition_does_not_wait_for_or_start_a_browser() {
    let session = Session {
        context: context(),
        interactive: AtomicBool::new(true),
        stop: CancellationToken::new(),
        process: AsyncMutex::new(None),
    };
    assert_eq!(
        exchange(&session, "token", false).await.unwrap_err().code,
        "sqlserver-sign-in-in-progress"
    );
    assert!(session.process.lock().await.is_none());
    assert_eq!(
        access_token(None).await.unwrap_err().code,
        "sqlserver-sign-in-required"
    );
}

#[tokio::test]
async fn stale_workspace_context_is_rejected_before_launch() {
    let mut context = context();
    context.epoch = u64::MAX;
    assert!(session(&context).is_err());
}

#[test]
fn only_safe_account_status_crosses_the_frontend_boundary() {
    let mut status = AuthStatus {
        state: "signed-out".into(),
        account: None,
        remembered: false,
        windows_available: false,
        windows_account: None,
        warning: None,
    };
    fill_status(
        &mut status,
        json!({"state":"signed-in","account":"unit@example.test","remembered":true,"accessToken":"DO-NOT-EXPOSE"}),
    );
    let payload = serde_json::to_string(&status).unwrap();
    assert!(!payload.contains("DO-NOT-EXPOSE"));
    let options = crate::domain::models::SqlServerConnectionOptions {
        authentication_context: Some(context()),
        ..Default::default()
    };
    let stored = serde_json::to_string(&options).unwrap();
    assert!(!stored.contains("unit-binding"));
    assert!(!stored.contains("authenticationContext"));
    assert!(
        serde_json::from_value::<crate::domain::models::SqlServerConnectionOptions>(
            json!({"authenticationContext":{"key":"forged"}})
        )
        .unwrap()
        .authentication_context
        .is_none()
    );
}

#[test]
fn unexpected_helper_errors_cannot_leak_provider_details() {
    let error = failure("SENSITIVE-PROVIDER-DETAIL");
    assert_eq!(error.code, "sqlserver-authentication-helper-failed");
    assert!(!error.message.contains("SENSITIVE"));
}

#[tokio::test]
async fn saving_preserves_idle_exact_binding_but_revokes_old_requests_and_changed_accounts() {
    let mut old = fake_session("require('readline').createInterface({input:process.stdin}).on('line',()=>console.log('{}'))");
    let id = "auth-preservation-unit-connection".to_owned();
    old.context.key = id.clone();
    old.context.connection_id = id.clone();
    old.context.versions = versions(&id, &old.context.environment_id);
    let old = Arc::new(old);
    sessions().lock().unwrap().insert(id.clone(), old.clone());
    let mut profile = ConnectionProfile {
        id: id.clone(),
        engine: "sqlserver".into(),
        environment_ids: vec![old.context.environment_id.clone()],
        sqlserver_options: Some(crate::domain::models::SqlServerConnectionOptions {
            authentication_mode: Some("azure-ad-interactive".into()),
            azure_tenant_id: Some(old.context.tenant_id.clone()),
            azure_client_id: Some(old.context.client_id.clone()),
            ..Default::default()
        }),
        ..Default::default()
    };
    connection_saved(&profile);
    assert!(!current(&old.context));
    assert!(old.stop.is_cancelled());
    let accepted = sessions().lock().unwrap().get(&id).cloned().unwrap();
    assert!(current(&accepted.context));
    assert!(accepted.process.lock().await.is_some());
    assert!(old.process.lock().await.is_none());
    profile.sqlserver_options.as_mut().unwrap().azure_tenant_id = Some("different-tenant".into());
    connection_saved(&profile);
    assert!(!sessions().lock().unwrap().contains_key(&id));
    assert!(accepted.stop.is_cancelled());
}

#[tokio::test]
async fn interactive_results_need_backend_acceptance_before_becoming_persistent() {
    let session = fake_session("require('readline').createInterface({input:process.stdin}).on('line',s=>console.log(JSON.stringify({state:JSON.parse(s).operation==='sign-in'?'awaiting-acceptance':'signed-in'})))");
    assert_eq!(
        exchange(&session, "sign-in", true).await.unwrap()["state"],
        "awaiting-acceptance"
    );
    session.stop.cancel();
    assert_eq!(
        exchange(&session, "complete-sign-in", true)
            .await
            .unwrap_err()
            .code,
        "sqlserver-sign-in-canceled"
    );
}
