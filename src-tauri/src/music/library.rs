// music/library.rs - 音乐库管理命令

use super::scanner::{scan_folder_recursive, scan_single_directory_internal};
use super::types::{FolderNode, LibraryFolder, Song};
use super::utils::normalize_path;
use crate::database::DbState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::{AppHandle, State};

fn clamp_i64_to_u32(v: i64) -> u32 {
    if v <= 0 {
        0
    } else if v > u32::MAX as i64 {
        u32::MAX
    } else {
        v as u32
    }
}

fn i64_to_u64_opt(v: Option<i64>) -> Option<u64> {
    v.filter(|x| *x >= 0).map(|x| x as u64)
}

fn i64_to_u8_opt(v: Option<i64>) -> Option<u8> {
    v.filter(|x| *x >= 0 && *x <= u8::MAX as i64)
        .map(|x| x as u8)
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn is_descendant_path(song_path: &str, folder_path: &str) -> bool {
    song_path == folder_path
        || song_path.starts_with(&format!("{folder_path}\\"))
        || song_path.starts_with(&format!("{folder_path}/"))
}

fn load_cached_songs(conn: &rusqlite::Connection) -> Result<Vec<Song>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, bitrate, sample_rate, bit_depth, format, container, codec, file_size, added_at, file_modified_at
             FROM songs",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let path: String = row.get(1)?;
            let duration = clamp_i64_to_u32(row.get::<_, Option<i64>>(11)?.unwrap_or(0));
            let bitrate = clamp_i64_to_u32(row.get::<_, Option<i64>>(12)?.unwrap_or(0));
            let sample_rate = clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0));
            let bit_depth = i64_to_u8_opt(row.get::<_, Option<i64>>(14)?);
            let file_size_i64 = row.get::<_, Option<i64>>(18)?.unwrap_or(0).max(0);
            let added_at_i64 = row.get::<_, Option<i64>>(19)?;
            let file_modified_at_i64 = row.get::<_, Option<i64>>(20)?;
            let artist_names = deserialize_string_list(row.get::<_, Option<String>>(4)?);
            let effective_artist_names = deserialize_string_list(row.get::<_, Option<String>>(5)?);

            let name = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());

            Ok(Song {
                id: row.get(0)?,
                name,
                path,
                title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                artist_names,
                effective_artist_names,
                album: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                is_various_artists_album: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
                collapse_artist_credits: row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
                duration,
                bitrate,
                sample_rate,
                bit_depth,
                format: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                container: row.get::<_, Option<String>>(16)?,
                codec: row.get::<_, Option<String>>(17)?,
                file_size: file_size_i64 as u64,
                added_at: i64_to_u64_opt(added_at_i64),
                file_modified_at: i64_to_u64_opt(file_modified_at_i64),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut songs: Vec<Song> = rows.filter_map(|row| row.ok()).collect();
    songs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(songs)
}

#[tauri::command]
pub async fn get_library_folders(
    db_state: State<'_, DbState>,
) -> Result<Vec<LibraryFolder>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM library_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;

        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut song_stmt = conn
            .prepare("SELECT path FROM songs")
            .map_err(|e| e.to_string())?;
        let song_paths: Vec<String> = song_stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut folders = Vec::with_capacity(paths.len());
        for folder_path in paths {
            let count = song_paths
                .iter()
                .filter(|song_path| is_descendant_path(song_path, &folder_path))
                .count();

            folders.push(LibraryFolder {
                path: folder_path,
                song_count: count,
            });
        }
        Ok::<Vec<LibraryFolder>, String>(folders)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn add_library_folder(path: String, db_state: State<'_, DbState>) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO library_folders (path, added_at) VALUES (?1, ?2)",
            [
                &normalized,
                &SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    .to_string(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn remove_library_folder(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM library_folders WHERE path = ?1", [&normalized])
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn get_library_songs_cached(db_state: State<'_, DbState>) -> Result<Vec<Song>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        load_cached_songs(&conn)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn scan_library(
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let folder_paths: Vec<String> = {
            let conn = db_conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT path FROM library_folders")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        let mut all_songs = Vec::new();

        let folder_total = folder_paths.len();
        for (index, folder) in folder_paths.into_iter().enumerate() {
            if let Ok(songs) = scan_single_directory_internal(
                folder,
                db_conn.clone(),
                Some(app.clone()),
                index + 1,
                folder_total.max(1),
            ) {
                all_songs.extend(songs);
            }
        }

        let mut unique_map = HashMap::new();
        for song in all_songs {
            unique_map.insert(song.path.clone(), song);
        }

        let mut result_vec: Vec<Song> = unique_map.into_values().collect();
        result_vec.sort_by(|a, b| a.name.cmp(&b.name));

        Ok::<Vec<Song>, String>(result_vec)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_hierarchy(
    db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT path FROM library_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;
        let roots: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut tree = Vec::new();

        for root in roots {
            let root_path = PathBuf::from(&root);
            if let Some(root_node) = scan_folder_recursive(root_path.clone(), 0, 1, &conn) {
                tree.push(root_node);
            }
        }

        Ok::<Vec<FolderNode>, String>(tree)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_folder_children(
    folder_path: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> {
    let db_conn = db_state.conn.clone();
    let normalized_folder = normalize_path(&folder_path);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let root_path = PathBuf::from(&normalized_folder);
        let read_dir = std::fs::read_dir(&root_path).map_err(|e| e.to_string())?;
        let mut subdirs: Vec<PathBuf> = read_dir
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();

        subdirs.sort_by(|left, right| {
            let left_name = left
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| left.to_string_lossy().into_owned());
            let right_name = right
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| right.to_string_lossy().into_owned());
            left_name.cmp(&right_name)
        });

        let children = subdirs
            .into_iter()
            .filter_map(|path| scan_folder_recursive(path, 0, 0, &conn))
            .collect();

        Ok::<Vec<FolderNode>, String>(children)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}
