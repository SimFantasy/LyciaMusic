use super::repository::{get_source_for_remote_uri, update_song_cache_path};
use super::types::{RemoteDownloadProgress, RemoteSourceCredentials};
use super::webdav;
use crate::database::DbState;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager};

const MAX_REMOTE_CACHE_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const REMOTE_DOWNLOAD_PROGRESS_EVENT: &str = "remote-download-progress";

pub(crate) fn is_remote_uri(path: &str) -> bool {
    path.starts_with("remote://")
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("remote-audio");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn cache_file_name(remote_uri: &str, etag: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(remote_uri.as_bytes());
    if let Some(etag) = etag {
        hasher.update(etag.as_bytes());
    }
    let hash = hex::encode(hasher.finalize());
    let ext = remote_uri
        .rsplit('.')
        .next()
        .filter(|value| value.len() <= 8 && !value.contains('/'))
        .unwrap_or("audio");
    format!("{hash}.{ext}")
}

fn cleanup_cache(root: &PathBuf) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            Some((path, metadata.len(), modified))
        })
        .collect::<Vec<_>>();
    let mut total = files.iter().map(|(_, size, _)| *size).sum::<u64>();
    if total <= MAX_REMOTE_CACHE_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total <= MAX_REMOTE_CACHE_BYTES {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

fn emit_download_progress(
    app: &AppHandle,
    remote_uri: &str,
    downloaded: u64,
    total: Option<u64>,
    done: bool,
    failed: bool,
    message: Option<String>,
) {
    let percent = total
        .filter(|value| *value > 0)
        .map(|value| ((downloaded as f64 / value as f64) * 100.0).clamp(0.0, 100.0));
    let _ = app.emit(
        REMOTE_DOWNLOAD_PROGRESS_EVENT,
        RemoteDownloadProgress {
            uri: remote_uri.to_string(),
            downloaded,
            total,
            percent,
            done,
            failed,
            message,
        },
    );
}

pub(crate) async fn cache_remote_file(
    app: &AppHandle,
    source: &RemoteSourceCredentials,
    remote_path: &str,
    remote_uri: &str,
    etag: Option<&str>,
) -> Result<String, String> {
    let root = cache_root(app)?;
    let cache_path = root.join(cache_file_name(remote_uri, etag));

    if cache_path.is_file() {
        return Ok(cache_path.to_string_lossy().into_owned());
    }

    let temp_path = cache_path.with_extension("download");
    if temp_path.is_file() {
        let _ = fs::remove_file(&temp_path);
    }

    let result =
        webdav::download_file_to_path(source, remote_path, &temp_path, |downloaded, total| {
            emit_download_progress(app, remote_uri, downloaded, total, false, false, None);
        })
        .await;

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        emit_download_progress(app, remote_uri, 0, None, true, true, Some(error.clone()));
        return Err(error);
    }

    fs::rename(&temp_path, &cache_path).map_err(|error| error.to_string())?;
    cleanup_cache(&root);

    let cache_path_str = cache_path.to_string_lossy().into_owned();
    emit_download_progress(app, remote_uri, 1, Some(1), true, false, None);
    Ok(cache_path_str)
}

pub(crate) async fn ensure_cached_path(
    app: &AppHandle,
    db_state: &DbState,
    remote_uri: &str,
) -> Result<String, String> {
    let (source, remote_path, etag, stored_remote_uri) = {
        let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
        get_source_for_remote_uri(&conn, remote_uri)?
    };
    let normalized_uri = stored_remote_uri.unwrap_or_else(|| remote_uri.to_string());
    let cache_path_str =
        cache_remote_file(app, &source, &remote_path, &normalized_uri, etag.as_deref()).await?;
    if let Ok(conn) = db_state.conn.lock() {
        let _ = update_song_cache_path(&conn, &normalized_uri, &cache_path_str);
    }

    Ok(cache_path_str)
}
