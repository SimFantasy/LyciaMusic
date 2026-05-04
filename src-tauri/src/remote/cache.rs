use super::repository::{get_source_for_remote_uri, update_song_cache_path};
use super::webdav;
use crate::database::DbState;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

const MAX_REMOTE_CACHE_BYTES: u64 = 5 * 1024 * 1024 * 1024;

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
    let root = cache_root(app)?;
    let cache_path = root.join(cache_file_name(&normalized_uri, etag.as_deref()));

    if cache_path.is_file() {
        return Ok(cache_path.to_string_lossy().into_owned());
    }

    let temp_path = cache_path.with_extension("download");
    webdav::download_file_to_path(&source, &remote_path, &temp_path).await?;
    fs::rename(&temp_path, &cache_path).map_err(|error| error.to_string())?;
    cleanup_cache(&root);

    let cache_path_str = cache_path.to_string_lossy().into_owned();
    if let Ok(conn) = db_state.conn.lock() {
        let _ = update_song_cache_path(&conn, &normalized_uri, &cache_path_str);
    }

    Ok(cache_path_str)
}
