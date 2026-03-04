use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionPayload {
    state: String,
    client_id: Option<String>,
    url: Option<String>,
    error: Option<String>,
}

pub fn spawn_ws_client(
    app: AppHandle,
    client_id: String,
    backend_base_url: String,
    reconnect_notify: Arc<Notify>,
) {
    tauri::async_runtime::spawn(async move {
        run_ws_loop(app, client_id, backend_base_url, reconnect_notify).await;
    });
}

async fn run_ws_loop(
    app: AppHandle,
    client_id: String,
    backend_base_url: String,
    reconnect_notify: Arc<Notify>,
) {
    let backoff_steps = [1_u64, 2, 5, 10, 20, 30];
    let mut backoff_index = 0_usize;

    loop {
        let ws_url = build_ws_url(&backend_base_url, &client_id);
        emit_connection(
            &app,
            ConnectionPayload {
                state: "connecting".into(),
                client_id: Some(client_id.clone()),
                url: Some(ws_url.clone()),
                error: None,
            },
        );

        match connect_async(ws_url.as_str()).await {
            Ok((stream, _)) => {
                backoff_index = 0;
                emit_connection(
                    &app,
                    ConnectionPayload {
                        state: "connected".into(),
                        client_id: Some(client_id.clone()),
                        url: Some(ws_url.clone()),
                        error: None,
                    },
                );

                let (mut writer, mut reader) = stream.split();
                loop {
                    tokio::select! {
                        _ = reconnect_notify.notified() => {
                            let _ = writer.close().await;
                            break;
                        }
                        incoming = reader.next() => match incoming {
                            Some(Ok(Message::Text(text))) => {
                                let _ = app.emit("backend:event", serde_json::from_str::<serde_json::Value>(text.as_str()).unwrap_or_else(|_| serde_json::json!({
                                    "type": "job.failed",
                                    "request_id": "rust-ws",
                                    "message": "invalid_backend_event"
                                })));
                            }
                            Some(Ok(Message::Close(_))) | None => {
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(error)) => {
                                emit_connection(
                                    &app,
                                    ConnectionPayload {
                                        state: "reconnecting".into(),
                                        client_id: Some(client_id.clone()),
                                        url: Some(ws_url.clone()),
                                        error: Some(error.to_string()),
                                    },
                                );
                                break;
                            }
                        }
                    }
                }
            }
            Err(error) => {
                emit_connection(
                    &app,
                    ConnectionPayload {
                        state: "reconnecting".into(),
                        client_id: Some(client_id.clone()),
                        url: Some(ws_url.clone()),
                        error: Some(error.to_string()),
                    },
                );
            }
        }

        let wait_seconds = backoff_steps[backoff_index.min(backoff_steps.len() - 1)];
        backoff_index += 1;
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(wait_seconds)) => {}
            _ = reconnect_notify.notified() => {}
        }
    }
}

fn emit_connection(app: &AppHandle, payload: ConnectionPayload) {
    let _ = app.emit("backend:connection", payload);
}

fn build_ws_url(base_url: &str, client_id: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let scheme = if trimmed.starts_with("https://") {
        "wss://"
    } else {
        "ws://"
    };
    format!("{scheme}{without_scheme}/ws?client_id={client_id}&client=tauri")
}
