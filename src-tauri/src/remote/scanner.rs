use super::cache;
use super::repository::{replace_remote_files, update_sync_status};
use super::types::{
    RemoteFileEntry, RemoteSourceCredentials, RemoteSyncProgress, RemoteSyncResult,
};
use super::webdav;
use crate::music::covers::get_or_create_thumbnail;
use crate::music::scanner::{apply_scan_changes, parse_song_from_file};
use crate::music::types::Song;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const REMOTE_SYNC_PROGRESS_EVENT: &str = "remote-sync-progress";

#[derive(Clone)]
struct RemoteSongSnapshot {
    etag: Option<String>,
    size: u64,
    modified_at: Option<String>,
    song: Option<Song>,
}

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

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn i64_to_u64_opt(value: Option<i64>) -> Option<u64> {
    value.filter(|value| *value >= 0).map(|value| value as u64)
}

fn i64_to_u32(value: Option<i64>) -> u32 {
    value.unwrap_or(0).clamp(0, u32::MAX as i64) as u32
}

fn i64_to_u8_opt(value: Option<i64>) -> Option<u8> {
    value
        .filter(|value| *value >= 0 && *value <= u8::MAX as i64)
        .map(|value| value as u8)
}

fn i64_to_bool(value: Option<i64>) -> bool {
    value.unwrap_or(0) != 0
}

fn remote_file_needs_refresh(
    snapshot: Option<&RemoteSongSnapshot>,
    file: &RemoteFileEntry,
) -> bool {
    let Some(snapshot) = snapshot else {
        return true;
    };
    if snapshot.song.is_none() {
        return true;
    }
    if snapshot
        .song
        .as_ref()
        .map(|song| song.duration == 0 || song.bitrate == 0 || song.sample_rate == 0)
        .unwrap_or(true)
    {
        return true;
    }

    match (snapshot.etag.as_deref(), file.etag.as_deref()) {
        (Some(previous), Some(current)) if !previous.is_empty() && !current.is_empty() => {
            previous != current
        }
        _ => {
            snapshot.size != file.size
                || match (snapshot.modified_at.as_deref(), file.modified_at.as_deref()) {
                    (Some(previous), Some(current)) => previous != current,
                    _ => false,
                }
        }
    }
}

fn load_remote_song_snapshots(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<HashMap<String, RemoteSongSnapshot>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT
                rf.remote_uri,
                rf.etag,
                rf.size,
                rf.modified_at,
                s.id,
                s.path,
                s.title,
                s.artist,
                s.artist_names,
                s.effective_artist_names,
                s.album,
                s.album_artist,
                s.album_key,
                s.is_various_artists_album,
                s.collapse_artist_credits,
                s.duration,
                s.cover_thumb_path,
                s.bitrate,
                s.sample_rate,
                s.bit_depth,
                s.format,
                s.container,
                s.codec,
                s.file_size,
                s.track_number,
                s.disc_number,
                s.added_at,
                s.file_modified_at
             FROM remote_files rf
             LEFT JOIN songs s ON s.path = rf.remote_uri
             WHERE rf.source_id = ?1 AND rf.is_audio = 1",
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map([source_id], |row| {
            let remote_uri: String = row.get(0)?;
            let song_path: Option<String> = row.get(5)?;
            let song = match song_path {
                Some(path) => {
                    let artist_names = deserialize_string_list(row.get::<_, Option<String>>(8)?);
                    let effective_artist_names =
                        deserialize_string_list(row.get::<_, Option<String>>(9)?);
                    let name = Path::new(&path)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.clone());

                    Some(Song {
                        id: row.get::<_, Option<i64>>(4)?,
                        name,
                        path,
                        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                        artist_names,
                        effective_artist_names,
                        album: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                        album_artist: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                        album_key: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                        is_various_artists_album: i64_to_bool(row.get::<_, Option<i64>>(13)?),
                        collapse_artist_credits: i64_to_bool(row.get::<_, Option<i64>>(14)?),
                        duration: i64_to_u32(row.get::<_, Option<i64>>(15)?),
                        cover_thumb_path: row.get::<_, Option<String>>(16)?,
                        bitrate: i64_to_u32(row.get::<_, Option<i64>>(17)?),
                        sample_rate: i64_to_u32(row.get::<_, Option<i64>>(18)?),
                        bit_depth: i64_to_u8_opt(row.get::<_, Option<i64>>(19)?),
                        format: row.get::<_, Option<String>>(20)?.unwrap_or_default(),
                        container: row.get::<_, Option<String>>(21)?,
                        codec: row.get::<_, Option<String>>(22)?,
                        file_size: row.get::<_, Option<i64>>(23)?.unwrap_or(0).max(0) as u64,
                        track_number: row.get::<_, Option<String>>(24)?,
                        disc_number: row.get::<_, Option<String>>(25)?,
                        added_at: i64_to_u64_opt(row.get::<_, Option<i64>>(26)?),
                        file_modified_at: i64_to_u64_opt(row.get::<_, Option<i64>>(27)?),
                    })
                }
                None => None,
            };

            Ok((
                remote_uri,
                RemoteSongSnapshot {
                    etag: row.get::<_, Option<String>>(1)?,
                    size: row.get::<_, i64>(2)?.max(0) as u64,
                    modified_at: row.get::<_, Option<String>>(3)?,
                    song,
                },
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut snapshots = HashMap::new();
    for row in rows {
        let (remote_uri, snapshot) = row.map_err(|error| error.to_string())?;
        snapshots.insert(remote_uri, snapshot);
    }
    Ok(snapshots)
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
) -> Result<Song, String> {
    let remote_uri = file.remote_uri(&source.id);
    let fallback = || song_from_remote_file(source, file);
    let cache_path = cache::cache_remote_file(
        app,
        source,
        &file.remote_path,
        &remote_uri,
        file.etag.as_deref(),
    )
    .await
    .map_err(|error| format!("下载远程歌曲失败：{}：{}", file.name, error))?;

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
    if song.cover_thumb_path.is_none() {
        let app_clone = app.clone();
        let cache_path = PathBuf::from(cache_path);
        song.cover_thumb_path = tauri::async_runtime::spawn_blocking(move || {
            get_or_create_thumbnail(&cache_path, &app_clone)
        })
        .await
        .ok()
        .flatten();
    }
    Ok(song)
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
    let snapshots = {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        match load_remote_song_snapshots(&conn, &source.id) {
            Ok(snapshots) => snapshots,
            Err(error) => {
                let _ = update_sync_status(&conn, &source.id, Some(&error));
                emit_sync_progress(&app, &source.id, "error", 0, 0, error.clone(), true, true);
                return Err(error);
            }
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
        let remote_uri = file.remote_uri(&source.id);
        if let Some(snapshot) = snapshots.get(&remote_uri) {
            if !remote_file_needs_refresh(Some(snapshot), file) {
                if let Some(song) = snapshot.song.clone() {
                    songs.push(song);
                    continue;
                }
            }
        }
        match song_with_remote_metadata(&app, &source, file).await {
            Ok(song) => songs.push(song),
            Err(error) => {
                if let Ok(conn) = db_conn.lock() {
                    let _ = update_sync_status(&conn, &source.id, Some(&error));
                }
                emit_sync_progress(
                    &app,
                    &source.id,
                    "error",
                    current,
                    total,
                    error.clone(),
                    true,
                    true,
                );
                return Err(error);
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn remote_file(etag: Option<&str>, size: u64, modified_at: Option<&str>) -> RemoteFileEntry {
        RemoteFileEntry {
            remote_path: "/demo.flac".to_string(),
            name: "demo.flac".to_string(),
            size,
            etag: etag.map(ToOwned::to_owned),
            modified_at: modified_at.map(ToOwned::to_owned),
            is_dir: false,
        }
    }

    fn remote_source() -> RemoteSourceCredentials {
        RemoteSourceCredentials {
            id: "source".to_string(),
            name: "Source".to_string(),
            provider: "webdav".to_string(),
            base_url: "https://example.com".to_string(),
            username: None,
            password: None,
            root_path: "/".to_string(),
            enabled: true,
            last_sync_at: None,
            last_sync_error: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn complete_remote_song() -> Song {
        let mut song = song_from_remote_file(
            &remote_source(),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT")),
        );
        song.duration = 180;
        song.bitrate = 320;
        song.sample_rate = 44_100;
        song
    }

    #[test]
    fn unchanged_remote_file_with_existing_song_does_not_need_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: Some(complete_remote_song()),
        };

        assert!(!remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 2048, Some("changed"))
        ));
    }

    #[test]
    fn incomplete_remote_song_needs_refresh_even_when_etag_matches() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: Some(song_from_remote_file(
                &remote_source(),
                &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT")),
            )),
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }

    #[test]
    fn changed_remote_file_needs_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: None,
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-b"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }

    #[test]
    fn remote_file_without_existing_song_needs_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: None,
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }
}
