#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ws_client;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

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

#[derive(Debug, Serialize)]
struct MoveExecutionResult {
    success: bool,
    from_path: String,
    to_path: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct StageUploadResult {
    success: bool,
    source_path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct CleanupResult {
    success: bool,
    removed: u64,
    error: Option<String>,
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

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn move_local_file(source_path: String, destination_dir: String) -> MoveExecutionResult {
    let destination_path = Path::new(&destination_dir).join(
        Path::new(&source_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("moved-file"),
    );
    execute_move(Path::new(&source_path), &destination_path)
}

#[tauri::command]
fn undo_local_file_move(from_path: String, to_path: String) -> MoveExecutionResult {
    execute_move(Path::new(&from_path), Path::new(&to_path))
}

#[tauri::command]
fn stage_local_upload(file_name: String, bytes: Vec<u8>) -> StageUploadResult {
    let result = (|| -> Result<PathBuf, io::Error> {
        let root = staging_root();
        fs::create_dir_all(&root)?;
        let sanitized = sanitize_filename(&file_name);
        let staged_name = format!("{}-{}", Uuid::new_v4(), sanitized);
        let staged_path = root.join(staged_name);
        fs::write(&staged_path, bytes)?;
        Ok(staged_path)
    })();

    match result {
        Ok(path) => StageUploadResult {
            success: true,
            source_path: Some(path.to_string_lossy().to_string()),
            error: None,
        },
        Err(error) => StageUploadResult {
            success: false,
            source_path: None,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn cleanup_staged_uploads(max_age_hours: u64) -> CleanupResult {
    let mut removed: u64 = 0;
    let max_age = Duration::from_secs(max_age_hours.saturating_mul(3600));
    let result = (|| -> Result<(), io::Error> {
        let root = staging_root();
        if !root.exists() {
            return Ok(());
        }
        let now = SystemTime::now();
        for entry_result in fs::read_dir(&root)? {
            let entry = entry_result?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let modified = entry.metadata()?.modified()?;
            let age = now
                .duration_since(modified)
                .unwrap_or(Duration::from_secs(0));
            if age >= max_age {
                fs::remove_file(path)?;
                removed = removed.saturating_add(1);
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => CleanupResult {
            success: true,
            removed,
            error: None,
        },
        Err(error) => CleanupResult {
            success: false,
            removed,
            error: Some(error.to_string()),
        },
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let client_id = load_or_create_client_id(&app_handle)?;
            let backend_base_url =
                std::env::var("ADH_BACKEND_URL").unwrap_or_else(|_| "http://localhost:9000".into());
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
            reconnect_backend_ws,
            show_in_folder,
            move_local_file,
            undo_local_file_move,
            stage_local_upload,
            cleanup_staged_uploads
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

fn execute_move(source_path: &Path, destination_path: &Path) -> MoveExecutionResult {
    let from_path = source_path.to_string_lossy().to_string();
    let to_path = destination_path.to_string_lossy().to_string();

    let result = (|| -> Result<(), io::Error> {
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)?;
        }
        match fs::rename(source_path, destination_path) {
            Ok(()) => Ok(()),
            Err(_) => {
                fs::copy(source_path, destination_path)?;
                fs::remove_file(source_path)?;
                Ok(())
            }
        }
    })();

    match result {
        Ok(()) => MoveExecutionResult {
            success: true,
            from_path,
            to_path,
            error: None,
        },
        Err(error) => MoveExecutionResult {
            success: false,
            from_path,
            to_path,
            error: Some(error.to_string()),
        },
    }
}

fn staging_root() -> PathBuf {
    std::env::temp_dir().join("agentic-docs").join("uploads")
}

fn sanitize_filename(file_name: &str) -> String {
    let base_name = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("upload.bin");
    let sanitized: String = base_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '.' || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "upload.bin".to_string()
    } else {
        sanitized
    }
}
