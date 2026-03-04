#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ws_client;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tokio::sync::Notify;
use uuid::Uuid;

struct AppRuntimeState {
    client_id: String,
    backend_base_url: String,
    reconnect_notify: Arc<Notify>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedClientState {
    client_id: String,
}

#[tauri::command]
fn get_client_id(state: State<'_, AppRuntimeState>) -> String {
    state.client_id.clone()
}

#[tauri::command]
fn get_backend_base_url(state: State<'_, AppRuntimeState>) -> String {
    state.backend_base_url.clone()
}

#[tauri::command]
fn reconnect_backend_ws(state: State<'_, AppRuntimeState>) {
    state.reconnect_notify.notify_waiters();
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let client_id = load_or_create_client_id(&app_handle)?;
            let backend_base_url =
                std::env::var("ADH_BACKEND_URL").unwrap_or_else(|_| "http://ai-server:9000".into());
            let reconnect_notify = Arc::new(Notify::new());

            app.manage(AppRuntimeState {
                client_id: client_id.clone(),
                backend_base_url: backend_base_url.clone(),
                reconnect_notify: reconnect_notify.clone(),
            });

            ws_client::spawn_ws_client(
                app_handle,
                client_id,
                backend_base_url,
                reconnect_notify,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_client_id,
            get_backend_base_url,
            reconnect_backend_ws
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn load_or_create_client_id(app: &tauri::AppHandle) -> Result<String, Box<dyn std::error::Error>> {
    let state_path = persisted_state_path(app)?;
    if state_path.exists() {
        let contents = fs::read_to_string(&state_path)?;
        let state: PersistedClientState = serde_json::from_str(&contents)?;
        return Ok(state.client_id);
    }

    let client_id = Uuid::new_v4().to_string();
    let payload = PersistedClientState {
        client_id: client_id.clone(),
    };
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(state_path, serde_json::to_string_pretty(&payload)?)?;
    Ok(client_id)
}

fn persisted_state_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let base_dir = app.path().app_config_dir()?;
    Ok(base_dir.join("desktop-state.json"))
}
