mod backend;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = tauri::async_runtime::block_on(async {
                match backend::AppState::initialize().await {
                    Ok(state) => Ok(state),
                    Err(error) => {
                        eprintln!("[backend] Failed to initialize Turso from env: {error}");
                        eprintln!(
                            "[backend] Falling back to local database. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to use Turso."
                        );
                        backend::AppState::initialize_local_fallback().await
                    }
                }
            })
            .map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::commands::backend_health,
            backend::commands::create_thread,
            backend::commands::list_threads,
            backend::commands::add_thread_message,
            backend::commands::list_thread_messages,
            backend::commands::connect_provider,
            backend::commands::start_provider_device_auth,
            backend::commands::poll_provider_device_auth,
            backend::commands::get_provider_connection,
            backend::commands::list_provider_connections,
            backend::commands::disconnect_provider,
            backend::commands::clone_repository,
            backend::commands::compare_workspace_diff,
            backend::commands::list_workspace_branches,
            backend::commands::checkout_workspace_branch,
            backend::commands::create_workspace_branch,
            backend::commands::run_code_intel_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
