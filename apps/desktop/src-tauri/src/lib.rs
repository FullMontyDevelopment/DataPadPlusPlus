use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub mod adapters;
pub mod app;
pub mod commands;
pub mod core;
pub mod domain;
pub mod infrastructure;
pub mod persistence;
pub mod security;

const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_QUIT_ID: &str = "tray-quit";

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn bundled_app_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).map(|icon| icon.to_owned())
}

fn configure_main_window_icon(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_icon(bundled_app_icon()?)?;
    }

    Ok(())
}

fn tray_icon_image(app: &tauri::App) -> tauri::Result<tauri::image::Image<'static>> {
    if let Some(icon) = app.default_window_icon() {
        return Ok(icon.clone().to_owned());
    }

    bundled_app_icon()
}

fn configure_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Show DataPad++", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit DataPad++", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = tray_icon_image(app)?;

    TrayIconBuilder::with_id("main")
        .tooltip("DataPad++")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app_handle),
            TRAY_QUIT_ID => app_handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    infrastructure::initialize_app_logging();
    tauri::Builder::default()
        .setup(|app| {
            infrastructure::log_info("app", "Tauri setup started.");
            app.manage(std::sync::Mutex::new(app::runtime::ManagedAppState::load(
                app.handle().clone(),
            )));
            app.manage(std::sync::Mutex::new(
                app::runtime::ActiveExecutionRegistry::default(),
            ));
            app.manage(std::sync::Mutex::new(
                app::runtime::datastore_api_server::DatastoreApiServerManager::default(),
            ));
            app.manage(std::sync::Mutex::new(
                app::runtime::datastore_mcp_server::DatastoreMcpServerManager::default(),
            ));
            app.manage(
                app::runtime::datastore_security_checks::DatastoreSecurityCheckManager::default(),
            );
            {
                let app_handle = app.handle().clone();
                let state = app.state::<app::runtime::SharedAppState>();
                let api_server =
                    app.state::<app::runtime::datastore_api_server::SharedDatastoreApiServer>();
                match state.lock() {
                    Ok(mut runtime) => {
                        match app::runtime::datastore_api_server::auto_start_if_configured(
                            app_handle,
                            &api_server,
                            &mut runtime,
                        ) {
                            Ok(Some(status)) => infrastructure::log_info(
                                "api-server",
                                format!(
                                    "Auto-started experimental API server at {}.",
                                    status.base_url.unwrap_or_else(|| "127.0.0.1".into())
                                ),
                            ),
                            Ok(None) => {}
                            Err(error) => infrastructure::log_warning(
                                "api-server",
                                format!("API server auto-start skipped: {}", error.message),
                            ),
                        }
                    }
                    Err(_) => infrastructure::log_warning(
                        "api-server",
                        "API server auto-start skipped because workspace state was unavailable.",
                    ),
                };
            }
            {
                let app_handle = app.handle().clone();
                let state = app.state::<app::runtime::SharedAppState>();
                let mcp_server =
                    app.state::<app::runtime::datastore_mcp_server::SharedDatastoreMcpServer>();
                match state.lock() {
                    Ok(mut runtime) => {
                        match app::runtime::datastore_mcp_server::auto_start_if_configured(
                            app_handle,
                            &mcp_server,
                            &mut runtime,
                        ) {
                            Ok(Some(status)) => infrastructure::log_info(
                                "mcp-server",
                                format!(
                                    "Auto-started experimental MCP server at {}.",
                                    status.endpoint.unwrap_or_else(|| "127.0.0.1".into())
                                ),
                            ),
                            Ok(None) => {}
                            Err(error) => infrastructure::log_warning(
                                "mcp-server",
                                format!("MCP server auto-start skipped: {}", error.message),
                            ),
                        }
                    }
                    Err(_) => infrastructure::log_warning(
                        "mcp-server",
                        "MCP server auto-start skipped because workspace state was unavailable.",
                    ),
                };
            }
            app.manage(app::runtime::app_updates::PendingAppUpdate::default());
            configure_main_window_icon(app)?;
            configure_system_tray(app)?;
            infrastructure::log_info("app", "Tauri setup completed.");
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(app::runtime::app_updates::updater_plugin())
        .invoke_handler(tauri::generate_handler![
            commands::app::bootstrap_app,
            commands::app::check_app_update,
            commands::app::clear_app_log_file,
            commands::app::create_diagnostics_report,
            commands::app::delete_app_log_file,
            commands::app::get_app_update_settings,
            commands::app::get_app_health,
            commands::app::install_app_update,
            commands::app::list_app_log_files,
            commands::app::read_app_log_file,
            commands::app::set_app_update_settings,
            commands::app::set_taskbar_query_activity,
            commands::app::store_secret,
            commands::workspace::cancel_execution_request,
            commands::workspace::cancel_test_run,
            commands::workspace::close_query_tab,
            commands::workspace::collect_adapter_diagnostics,
            commands::workspace::create_library_folder,
            commands::workspace::create_local_database,
            commands::workspace::create_workspace,
            commands::workspace::create_workspace_backup_now,
            commands::workspace::create_environment_tab,
            commands::workspace::create_explorer_tab,
            commands::workspace::create_metrics_tab,
            commands::workspace::create_object_view_tab,
            commands::workspace::create_datastore_api_server,
            commands::workspace::create_datastore_mcp_server,
            commands::workspace::create_api_server_tab,
            commands::workspace::create_mcp_server_tab,
            commands::workspace::create_query_tab,
            commands::workspace::create_scoped_query_tab,
            commands::workspace::create_settings_tab,
            commands::workspace::create_security_checks_tab,
            commands::workspace::create_test_suite_tab,
            commands::workspace::create_workspace_search_tab,
            commands::workspace::delete_connection_profile,
            commands::workspace::delete_environment_profile,
            commands::workspace::delete_library_node,
            commands::workspace::delete_datastore_api_server,
            commands::workspace::delete_datastore_mcp_server,
            commands::workspace::delete_datastore_mcp_server_token,
            commands::workspace::delete_workspace_backup,
            commands::workspace::delete_saved_work_item,
            commands::workspace::discover_datastore_api_server_query_sources,
            commands::workspace::discover_datastore_api_server_resources,
            commands::workspace::execute_data_edit,
            commands::workspace::execute_query_request,
            commands::workspace::execute_datastore_operation,
            commands::workspace::execute_test_suite,
            commands::workspace::export_result_file,
            commands::workspace::export_datastore_api_server_project_file,
            commands::workspace::export_workspace_bundle,
            commands::workspace::export_workspace_bundle_file,
            commands::workspace::fetch_document_node_children,
            commands::workspace::fetch_result_page,
            commands::workspace::get_datastore_api_server_logs,
            commands::workspace::get_datastore_api_server_metrics,
            commands::workspace::get_datastore_api_server_status,
            commands::workspace::get_datastore_mcp_server_logs,
            commands::workspace::get_datastore_mcp_server_metrics,
            commands::workspace::get_datastore_mcp_server_status,
            commands::workspace::get_datastore_security_check_status,
            commands::workspace::get_workspace_switcher_status,
            commands::workspace::import_workspace_bundle,
            commands::workspace::import_workspace_bundle_file,
            commands::workspace::inspect_explorer_node,
            commands::workspace::inspect_connection_permissions,
            commands::workspace::inspect_redis_key,
            commands::workspace::list_explorer_nodes,
            commands::workspace::list_datastore_operations,
            commands::workspace::list_datastore_experiences,
            commands::workspace::list_workspace_backups,
            commands::workspace::load_structure_map,
            commands::workspace::move_library_node,
            commands::workspace::open_library_item,
            commands::workspace::open_test_suite_template,
            commands::workspace::open_saved_work_item,
            commands::workspace::plan_data_edit,
            commands::workspace::plan_datastore_operation,
            commands::workspace::pick_local_database_file,
            commands::workspace::preview_datastore_mcp_client_setup,
            commands::workspace::reorder_query_tabs,
            commands::workspace::refresh_metrics_tab,
            commands::workspace::refresh_object_view_tab,
            commands::workspace::reopen_closed_query_tab,
            commands::workspace::rename_query_tab,
            commands::workspace::rename_library_node,
            commands::workspace::rename_workspace,
            commands::workspace::restore_workspace_backup,
            commands::workspace::refresh_datastore_security_checks,
            commands::workspace::save_query_tab_to_library,
            commands::workspace::save_query_tab_to_local_file,
            commands::workspace::save_query_tab,
            commands::workspace::scan_redis_keys,
            commands::workspace::set_active_connection,
            commands::workspace::set_active_tab,
            commands::workspace::set_workspace_switcher_enabled,
            commands::workspace::set_explorer_folder_order,
            commands::workspace::set_first_install_guide_status,
            commands::workspace::set_keyboard_shortcut,
            commands::workspace::set_library_node_environment,
            commands::workspace::set_tab_environment,
            commands::workspace::set_safe_mode_enabled,
            commands::workspace::set_theme,
            commands::workspace::set_ui_state,
            commands::workspace::start_datastore_api_server,
            commands::workspace::start_datastore_mcp_server,
            commands::workspace::stop_datastore_api_server,
            commands::workspace::stop_datastore_mcp_server,
            commands::workspace::switch_workspace,
            commands::workspace::test_connection,
            commands::workspace::unlock_app,
            commands::workspace::add_datastore_api_server_custom_endpoint,
            commands::workspace::add_datastore_api_server_resources,
            commands::workspace::apply_datastore_mcp_client_setup,
            commands::workspace::remove_datastore_api_server_custom_endpoint,
            commands::workspace::remove_datastore_api_server_resource,
            commands::workspace::update_datastore_api_server,
            commands::workspace::update_datastore_api_server_custom_endpoint,
            commands::workspace::update_datastore_api_server_settings,
            commands::workspace::update_datastore_mcp_server,
            commands::workspace::update_datastore_mcp_server_settings,
            commands::workspace::update_datastore_security_check_settings,
            commands::workspace::create_datastore_mcp_server_token,
            commands::workspace::update_query_builder_state,
            commands::workspace::update_query_tab_target,
            commands::workspace::update_query_tab,
            commands::workspace::update_test_suite_tab,
            commands::workspace::update_workspace_backup_settings,
            commands::workspace::update_workspace_search_settings,
            commands::workspace::upsert_connection_profile,
            commands::workspace::upsert_environment_profile,
            commands::workspace::upsert_saved_work_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running DataPad++");
}
