use super::cache;
use super::repository::{replace_remote_files, update_sync_status};
use super::types::{
    RemoteFileEntry, RemoteSourceCredentials, RemoteSyncProgress, RemoteSyncResult,
};
use super::webdav;
use crate::music::scanner::{apply_scan_changes, parse_song_from_file};
use crate::music::types::Song;
use rusqlite::params;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const REMOTE_SYNC_PROGRESS_EVENT: &str = "remote-sync-progress";

fn extension_from_path(path: &str) -> String {
    path.rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

fn title_from_name(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| name.to_string())
}

fn song_from_remote_file(source: &RemoteSourceCredentials, file: &RemoteFileEntry) -> Song {
    let remote_uri = file.remote_uri(&source.id);
    let title = title_from_name(&file.name);
    let artist = "未知歌手".to_string();
    let album = "未知专辑".to_string();

    Song {
        id: None,
        name: file.name.clone(),
        title,
        path: remote_uri,
        artist: artist.clone(),
        artist_names: vec![artist.clone()],
        effective_artist_names: vec![artist.clone()],
        album: album.clone(),
        album_artist: artist.clone(),
        album_key: format!("{}::{}", album.to_lowercase(), artist.to_lowercase()),
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration: 0,
        cover_thumb_path: None,
        bitrate: 0,
        sample_rate: 0,
        bit_depth: None,
        format: extension_from_path(&file.remote_path),
        container: None,
        codec: None,
        file_size: file.size,
        track_number: None,
        disc_number: None,
        added_at: None,
        file_modified_at: None,
    }
}

fn emit_sync_progress(
    app: &AppHandle,
    source_id: &str,
    phase: &str,
    current: usize,
    total: usize,
    message: impl Into<String>,
    done: bool,
    failed: bool,
) {
    let _ = app.emit(
        REMOTE_SYNC_PROGRESS_EVENT,
        RemoteSyncProgress {
            source_id: source_id.to_string(),
            phase: phase.to_string(),
            current,
            total,
            message: message.into(),
            done,
            failed,
        },
    );
}

async fn song_with_remote_metadata(
    app: &AppHandle,
    source: &RemoteSourceCredentials,
    file: &RemoteFileEntry,
) -> Song {
    let remote_uri = file.remote_uri(&source.id);
    let fallback = || song_from_remote_file(source, file);
    let Ok(cache_path) = cache::cache_remote_file(
        app,
        source,
        &file.remote_path,
        &remote_uri,
        file.etag.as_deref(),
    )
    .await
    else {
        return fallback();
    };

    let mut song = parse_song_from_file(
        Path::new(&cache_path),
        &remote_uri,
        &extension_from_path(&file.remote_path),
    )
    .unwrap_or_else(fallback);
    song.name = file.name.clone();
    song.path = remote_uri;
    if file.size > 0 {
        song.file_size = file.size;
    }
    song
}

fn existing_remote_song_paths(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path FROM songs WHERE remote_source_id = ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([source_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn mark_remote_songs(
    conn: &rusqlite::Connection,
    source: &RemoteSourceCredentials,
    files: &[RemoteFileEntry],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "UPDATE songs
             SET source_type = 'remote',
                 remote_source_id = ?1,
                 remote_uri = ?2,
                 remote_etag = ?3
             WHERE path = ?2",
        )
        .map_err(|error| error.to_string())?;

    for file in files {
        let remote_uri = file.remote_uri(&source.id);
        stmt.execute(params![&source.id, remote_uri, &file.etag])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub(crate) async fn sync_source(
    app: AppHandle,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    source: RemoteSourceCredentials,
) -> Result<RemoteSyncResult, String> {
    emit_sync_progress(
        &app,
        &source.id,
        "scanning",
        0,
        0,
        "正在读取远程目录",
        false,
        false,
    );
    let files = match webdav::collect_audio_files(&source).await {
        Ok(files) => files,
        Err(error) => {
            if let Ok(conn) = db_conn.lock() {
                let _ = update_sync_status(&conn, &source.id, Some(&error));
            }
            emit_sync_progress(&app, &source.id, "error", 0, 0, error.clone(), true, true);
            return Err(error);
        }
    };

    let mut songs = Vec::with_capacity(files.len());
    let total = files.len();
    for (index, file) in files.iter().enumerate() {
        let current = index + 1;
        emit_sync_progress(
            &app,
            &source.id,
            "parsing",
            current,
            total,
            format!("正在解析 {}", file.name),
            false,
            false,
        );
        songs.push(song_with_remote_metadata(&app, &source, file).await);
    }

    emit_sync_progress(
        &app,
        &source.id,
        "writing",
        total,
        total,
        "正在写入音乐库",
        false,
        false,
    );
    let write_result = (|| -> Result<(), String> {
        let mut conn = db_conn.lock().map_err(|error| error.to_string())?;
        let next_paths = songs
            .iter()
            .map(|song| song.path.clone())
            .collect::<HashSet<_>>();
        let to_delete = existing_remote_song_paths(&conn, &source.id)?
            .into_iter()
            .filter(|path| !next_paths.contains(path))
            .collect::<Vec<_>>();

        replace_remote_files(&mut conn, &source.id, &files)?;
        apply_scan_changes(&mut conn, &songs, &[], &to_delete, None)?;
        mark_remote_songs(&conn, &source, &files)?;
        update_sync_status(&conn, &source.id, None)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        if let Ok(conn) = db_conn.lock() {
            let _ = update_sync_status(&conn, &source.id, Some(&error));
        }
        emit_sync_progress(
            &app,
            &source.id,
            "error",
            total,
            total,
            error.clone(),
            true,
            true,
        );
        return Err(error);
    }

    emit_sync_progress(
        &app,
        &source.id,
        "complete",
        total,
        total,
        "同步完成",
        true,
        false,
    );
    Ok(RemoteSyncResult {
        source_id: source.id,
        indexed_files: files.len(),
        audio_files: files.len(),
        parsed_songs: songs.len(),
    })
}
