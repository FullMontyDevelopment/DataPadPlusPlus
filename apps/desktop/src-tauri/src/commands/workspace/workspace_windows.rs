use super::*;
use std::time::Duration;
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

fn lock_window_coordinator<'a, 'b>(
    coordinator: &'a State<'b, SharedWorkspaceWindowCoordinator>,
) -> Result<
    std::sync::MutexGuard<'a, crate::app::runtime::workspace_windows::WorkspaceWindowCoordinator>,
    CommandError,
> {
    coordinator.lock().map_err(|_| {
        CommandError::new(
            "window-coordinator-unavailable",
            "Window coordination is temporarily unavailable. Restart DataPad++ if this continues.",
        )
    })
}

#[tauri::command]
pub fn get_workspace_window_context(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
) -> Result<WorkspaceWindowContext, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.workspace_window_context(window.label()))
}

#[tauri::command]
pub fn list_workspace_windows(
    state: State<'_, SharedAppState>,
) -> Result<WorkspaceWindowListResponse, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.list_workspace_windows())
}

#[tauri::command]
pub async fn transfer_workspace_tab(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
    request: WorkspaceTabTransferRequest,
) -> Result<WorkspaceTabTransferResponse, CommandError> {
    let correlation_id = request
        .correlation_id
        .as_deref()
        .map(diagnostic_id)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| generate_id("window-transfer"));
    log_window_phase(
        "INFO",
        "tab-transfer-command-start",
        &correlation_id,
        format!(
            "callerWindow={} sourceWindow={} destinationWindow={} tab={} createWindow={}",
            diagnostic_id(window.label()),
            diagnostic_id(&request.source_window_id),
            request
                .destination_window_id
                .as_deref()
                .map(diagnostic_id)
                .unwrap_or_else(|| "new-window".into()),
            diagnostic_id(&request.tab_id),
            request.create_window.unwrap_or(false),
        ),
    );
    if request.source_window_id != window.label() {
        log_window_phase(
            "ERROR",
            "tab-transfer-source-mismatch",
            &correlation_id,
            format!(
                "callerWindow={} requestedSource={}",
                diagnostic_id(window.label()),
                diagnostic_id(&request.source_window_id),
            ),
        );
        return Err(CommandError::new(
            "tab-transfer-source-mismatch",
            "The tab transfer source did not match the current window.",
        ));
    }

    let create_window =
        request.create_window.unwrap_or(false) || request.destination_window_id.is_none();
    let destination_window_id = if create_window {
        generate_id("editor")
    } else {
        request
            .destination_window_id
            .clone()
            .unwrap_or_else(|| "main".into())
    };
    log_window_phase(
        "INFO",
        "tab-transfer-destination-resolved",
        &correlation_id,
        format!(
            "destinationWindow={} createWindow={create_window}",
            diagnostic_id(&destination_window_id),
        ),
    );

    let created_window = if create_window {
        let title = {
            let state = lock_state(&state)?;
            let tab = state
                .snapshot
                .tabs
                .iter()
                .find(|tab| tab.id == request.tab_id)
                .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
            format!("DataPad++ — {}", tab.title)
        };
        let mut builder = WebviewWindowBuilder::new(
            window.app_handle(),
            &destination_window_id,
            WebviewUrl::App("index.html".into()),
        )
        .title(title)
        .inner_size(1120.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .visible(false);
        if let (Some(x), Some(y)) = (request.x, request.y) {
            builder = builder.position(x as f64, y as f64);
        }
        log_window_phase(
            "INFO",
            "native-window-build-start",
            &correlation_id,
            format!(
                "destinationWindow={} visible=false width=1120 height=760 positioned={}",
                diagnostic_id(&destination_window_id),
                request.x.is_some() && request.y.is_some(),
            ),
        );
        let built = match builder.build() {
            Ok(created) => created,
            Err(error) => {
                log_window_phase(
                    "ERROR",
                    "native-window-build-failed",
                    &correlation_id,
                    format!(
                        "destinationWindow={} error={error}",
                        diagnostic_id(&destination_window_id),
                    ),
                );
                return Err(CommandError::new(
                    "window-create-failed",
                    format!("DataPad++ could not create the editor window: {error}"),
                ));
            }
        };
        log_window_phase(
            "INFO",
            "native-window-build-complete",
            &correlation_id,
            format!(
                "destinationWindow={}",
                diagnostic_id(&destination_window_id)
            ),
        );
        Some(built)
    } else {
        None
    };

    let transfer_result = {
        let mut state = lock_state(&state)?;
        if create_window {
            log_window_phase(
                "INFO",
                "window-layout-register-start",
                &correlation_id,
                format!(
                    "destinationWindow={}",
                    diagnostic_id(&destination_window_id)
                ),
            );
            state.add_editor_window_layout(&destination_window_id, &request);
            log_window_phase(
                "INFO",
                "window-layout-register-complete",
                &correlation_id,
                format!(
                    "destinationWindow={}",
                    diagnostic_id(&destination_window_id)
                ),
            );
        }
        log_window_phase(
            "INFO",
            "tab-ownership-transfer-start",
            &correlation_id,
            format!(
                "sourceWindow={} destinationWindow={} tab={}",
                diagnostic_id(&request.source_window_id),
                diagnostic_id(&destination_window_id),
                diagnostic_id(&request.tab_id),
            ),
        );
        state.transfer_workspace_tab(&request, &destination_window_id, !create_window)
    };

    let payload = match transfer_result {
        Ok(payload) => payload,
        Err(error) => {
            log_window_phase(
                "ERROR",
                "tab-ownership-transfer-failed",
                &correlation_id,
                format!(
                    "destinationWindow={} code={} message={}",
                    diagnostic_id(&destination_window_id),
                    diagnostic_id(&error.code),
                    error.message,
                ),
            );
            if let Some(created) = created_window {
                log_window_phase(
                    "WARN",
                    "failed-transfer-window-close",
                    &correlation_id,
                    format!(
                        "destinationWindow={}",
                        diagnostic_id(&destination_window_id)
                    ),
                );
                let _ = created.close();
            }
            return Err(error);
        }
    };
    log_window_phase(
        "INFO",
        "tab-ownership-transfer-complete",
        &correlation_id,
        format!(
            "sourceWindow={} destinationWindow={} tab={} revision={}",
            diagnostic_id(&request.source_window_id),
            diagnostic_id(&destination_window_id),
            diagnostic_id(&request.tab_id),
            payload.snapshot.workspace_revision,
        ),
    );

    if let Some(_created) = created_window {
        let app_handle = window.app_handle().clone();
        let rollback_window_id = destination_window_id.clone();
        let timeout_correlation_id = correlation_id.clone();
        log_window_phase(
            "INFO",
            "window-ready-timeout-scheduled",
            &correlation_id,
            format!(
                "destinationWindow={} timeoutSeconds=15",
                diagnostic_id(&destination_window_id),
            ),
        );
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let Some(pending) = app_handle.get_webview_window(&rollback_window_id) else {
                log_window_phase(
                    "INFO",
                    "window-ready-timeout-window-missing",
                    &timeout_correlation_id,
                    format!("destinationWindow={}", diagnostic_id(&rollback_window_id)),
                );
                return;
            };
            if pending.is_visible().unwrap_or(false) {
                log_window_phase(
                    "INFO",
                    "window-ready-timeout-skipped-visible",
                    &timeout_correlation_id,
                    format!("destinationWindow={}", diagnostic_id(&rollback_window_id)),
                );
                return;
            }
            log_window_phase(
                "ERROR",
                "window-ready-timeout-rollback-start",
                &timeout_correlation_id,
                format!("destinationWindow={}", diagnostic_id(&rollback_window_id)),
            );
            let state = app_handle.state::<SharedAppState>();
            if let Ok(mut state) = state.lock() {
                match state.reattach_workspace_window(&rollback_window_id) {
                    Ok(_) => log_window_phase(
                        "INFO",
                        "window-ready-timeout-rollback-complete",
                        &timeout_correlation_id,
                        format!("destinationWindow={}", diagnostic_id(&rollback_window_id)),
                    ),
                    Err(error) => log_window_phase(
                        "ERROR",
                        "window-ready-timeout-rollback-failed",
                        &timeout_correlation_id,
                        format!(
                            "destinationWindow={} code={} message={}",
                            diagnostic_id(&rollback_window_id),
                            diagnostic_id(&error.code),
                            error.message,
                        ),
                    ),
                }
            } else {
                log_window_phase(
                    "ERROR",
                    "window-ready-timeout-state-lock-failed",
                    &timeout_correlation_id,
                    format!("destinationWindow={}", diagnostic_id(&rollback_window_id)),
                );
            }
            let _ = pending.close();
        });
    } else if let Some(destination) = window
        .app_handle()
        .get_webview_window(&destination_window_id)
    {
        let _ = destination.show();
        let _ = destination.unminimize();
        let _ = destination.set_focus();
    }

    if request.source_window_id != "main"
        && !payload
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .any(|workspace_window| workspace_window.id == request.source_window_id)
    {
        log_window_phase(
            "INFO",
            "empty-source-window-close-request",
            &correlation_id,
            format!("sourceWindow={}", diagnostic_id(&request.source_window_id)),
        );
        if let Some(source) = window
            .app_handle()
            .get_webview_window(&request.source_window_id)
        {
            let _ = source.close();
        }
    }

    log_window_phase(
        "INFO",
        "tab-transfer-command-complete",
        &correlation_id,
        format!(
            "sourceWindow={} destinationWindow={} tab={} createdWindow={create_window}",
            diagnostic_id(&request.source_window_id),
            diagnostic_id(&destination_window_id),
            diagnostic_id(&request.tab_id),
        ),
    );

    Ok(WorkspaceTabTransferResponse {
        payload,
        source_window_id: request.source_window_id,
        destination_window_id,
        created_window: create_window,
    })
}

#[tauri::command]
pub fn workspace_editor_window_ready(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
) -> Result<(), CommandError> {
    let correlation_id = generate_id("window-ready");
    log_window_phase(
        "INFO",
        "window-ready-command-start",
        &correlation_id,
        format!("window={}", diagnostic_id(window.label())),
    );
    if window.label() == "main" {
        log_window_phase(
            "INFO",
            "window-ready-main-noop",
            &correlation_id,
            "window=main",
        );
        return Ok(());
    }
    let is_tracked = {
        let state = lock_state(&state)?;
        state
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .any(|workspace_window| workspace_window.id == window.label())
    };
    if !is_tracked {
        log_window_phase(
            "ERROR",
            "window-ready-layout-missing",
            &correlation_id,
            format!("window={}", diagnostic_id(window.label())),
        );
        return Err(CommandError::new(
            "window-missing",
            "This editor window no longer belongs to the active workspace.",
        ));
    }
    window.show().map_err(|error| {
        log_window_phase(
            "ERROR",
            "window-ready-show-failed",
            &correlation_id,
            format!("window={} error={error}", diagnostic_id(window.label())),
        );
        CommandError::new(
            "window-show-failed",
            format!("Unable to show the editor window: {error}"),
        )
    })?;
    log_window_phase(
        "INFO",
        "window-ready-show-complete",
        &correlation_id,
        format!("window={}", diagnostic_id(window.label())),
    );
    match window.set_focus() {
        Ok(()) => log_window_phase(
            "INFO",
            "window-ready-focus-complete",
            &correlation_id,
            format!("window={}", diagnostic_id(window.label())),
        ),
        Err(error) => log_window_phase(
            "WARN",
            "window-ready-focus-failed",
            &correlation_id,
            format!("window={} error={error}", diagnostic_id(window.label())),
        ),
    }
    Ok(())
}

fn log_window_phase(level: &str, phase: &str, correlation_id: &str, message: impl AsRef<str>) {
    infrastructure::log_window_lifecycle(
        level,
        phase,
        format!(
            "correlation={} {}",
            diagnostic_id(correlation_id),
            message.as_ref(),
        ),
    );
}

fn diagnostic_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(160)
        .collect()
}

#[tauri::command]
pub async fn restore_workspace_editor_windows(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
) -> Result<(), CommandError> {
    use crate::app::runtime::workspace_windows::{
        clamp_restored_window_bounds, WorkspaceMonitorBounds,
    };

    if window.label() != "main" {
        return Err(CommandError::new(
            "window-main-required",
            "Only the main window can restore editor windows.",
        ));
    }
    let monitors = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| WorkspaceMonitorBounds {
            name: monitor.name().cloned(),
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect::<Vec<_>>();
    let primary_monitor_name = window
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    let layouts = {
        let state = lock_state(&state)?;
        if !state.snapshot.preferences.multi_window_tabs.enabled {
            return Ok(());
        }
        state
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .filter(|workspace_window| {
                workspace_window.id != "main" && !workspace_window.tab_ids.is_empty()
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    for layout in layouts {
        if window.app_handle().get_webview_window(&layout.id).is_some() {
            continue;
        }
        let title = {
            let state = lock_state(&state)?;
            state
                .snapshot
                .tabs
                .iter()
                .find(|tab| tab.id == layout.active_tab_id)
                .map(|tab| format!("DataPad++ - {}", tab.title))
                .unwrap_or_else(|| "DataPad++ - Editor".into())
        };
        let bounds = clamp_restored_window_bounds(
            layout.bounds.as_ref(),
            layout.monitor_name.as_deref(),
            &monitors,
            primary_monitor_name.as_deref(),
        );
        let builder = WebviewWindowBuilder::new(
            window.app_handle(),
            &layout.id,
            WebviewUrl::App("index.html".into()),
        )
        .title(title)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .visible(false)
        .inner_size(bounds.width as f64, bounds.height as f64);
        let restored = builder.build().map_err(|error| {
            CommandError::new(
                "window-restore-failed",
                format!("Unable to restore an editor window: {error}"),
            )
        })?;
        let _ = restored.set_position(PhysicalPosition::new(bounds.x, bounds.y));
        let _ = restored.set_size(PhysicalSize::new(bounds.width, bounds.height));
        if layout.maximized {
            let _ = restored.maximize();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn shutdown_datapad_application(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
    coordinator: State<'_, SharedWorkspaceWindowCoordinator>,
) -> Result<(), CommandError> {
    if window.label() != "main" {
        return Err(CommandError::new(
            "window-main-required",
            "Only the main window can close DataPad++.",
        ));
    }
    {
        let state = lock_state(&state)?;
        if state.snapshot.tabs.iter().any(|tab| {
            tab.active_execution.is_some() || matches!(tab.status.as_str(), "running" | "queued")
        }) {
            return Err(CommandError::new(
                "window-execution-active",
                "Wait for running work to finish or cancel it before closing DataPad++.",
            ));
        }
    }
    lock_window_coordinator(&coordinator)?.shutting_down = true;
    window.app_handle().exit(0);
    Ok(())
}

#[tauri::command]
pub fn update_workspace_window_geometry(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
    request: WorkspaceWindowGeometryRequest,
) -> Result<BootstrapPayload, CommandError> {
    if request.window_id != window.label() {
        return Err(CommandError::new(
            "window-geometry-source-mismatch",
            "Window geometry can only be updated by its owning window.",
        ));
    }
    let mut state = lock_state(&state)?;
    state.update_workspace_window_geometry(request)
}

#[tauri::command]
pub fn close_workspace_editor_window(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
    request: WorkspaceWindowCloseRequest,
) -> Result<BootstrapPayload, CommandError> {
    if request.window_id == "main" {
        return Err(CommandError::new(
            "window-main",
            "The main window cannot be reattached.",
        ));
    }
    if request.window_id != window.label() {
        return Err(CommandError::new(
            "window-close-source-mismatch",
            "An editor window can only reattach its own tabs.",
        ));
    }
    let payload = {
        let mut state = lock_state(&state)?;
        state.reattach_workspace_window(&request.window_id)?
    };
    if let Some(target) = window.app_handle().get_webview_window(&request.window_id) {
        let _ = target.close();
    }
    if let Some(main) = window.app_handle().get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(payload)
}

#[tauri::command]
pub fn update_multi_window_tabs_settings(
    window: WebviewWindow,
    state: State<'_, SharedAppState>,
    request: MultiWindowTabsSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    if window.label() != "main" {
        return Err(CommandError::new(
            "window-main-required",
            "Multi-window settings can only be changed from the main window.",
        ));
    }
    let editor_window_ids = {
        let state = lock_state(&state)?;
        state
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .filter(|workspace_window| workspace_window.id != "main")
            .map(|workspace_window| workspace_window.id.clone())
            .collect::<Vec<_>>()
    };
    let payload = {
        let mut state = lock_state(&state)?;
        state.update_multi_window_tabs_settings(request.clone())?
    };
    if !request.enabled {
        for window_id in editor_window_ids {
            if let Some(editor) = window.app_handle().get_webview_window(&window_id) {
                let _ = editor.close();
            }
        }
    }
    Ok(payload)
}

#[tauri::command]
pub fn start_workspace_tab_drag(
    window: WebviewWindow,
    coordinator: State<'_, SharedWorkspaceWindowCoordinator>,
    request: WorkspaceTabDragSessionRequest,
) -> Result<WorkspaceTabDragSession, CommandError> {
    if request.source_window_id != window.label() {
        return Err(CommandError::new(
            "tab-drag-source-mismatch",
            "The tab drag source did not match the current window.",
        ));
    }
    let mut coordinator = lock_window_coordinator(&coordinator)?;
    Ok(coordinator.start_drag(request))
}

#[tauri::command]
pub fn get_workspace_tab_drag(
    coordinator: State<'_, SharedWorkspaceWindowCoordinator>,
) -> Result<Option<WorkspaceTabDragSession>, CommandError> {
    let coordinator = lock_window_coordinator(&coordinator)?;
    Ok(coordinator.active_drag())
}

#[tauri::command]
pub fn cancel_workspace_tab_drag(
    coordinator: State<'_, SharedWorkspaceWindowCoordinator>,
    token: Option<String>,
) -> Result<(), CommandError> {
    let mut coordinator = lock_window_coordinator(&coordinator)?;
    coordinator.cancel_drag(token.as_deref());
    Ok(())
}
