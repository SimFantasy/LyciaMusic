use super::repository::{replace_remote_files, update_sync_status};
use super::types::{RemoteFileEntry, RemoteSourceCredentials, RemoteSyncResult};
use super::webdav;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use rusqlite::params;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

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
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    source: RemoteSourceCredentials,
) -> Result<RemoteSyncResult, String> {
    let files = match webdav::collect_audio_files(&source).await {
        Ok(files) => files,
        Err(error) => {
            if let Ok(conn) = db_conn.lock() {
                let _ = update_sync_status(&conn, &source.id, Some(&error));
            }
            return Err(error);
        }
    };
    let mut conn = db_conn.lock().map_err(|error| error.to_string())?;
    let songs = files
        .iter()
        .map(|file| song_from_remote_file(&source, file))
        .collect::<Vec<_>>();
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

    Ok(RemoteSyncResult {
        source_id: source.id,
        indexed_files: files.len(),
        audio_files: files.len(),
        parsed_songs: songs.len(),
    })
}
