// music/files.rs - 文件操作命令

use super::lyrics::{build_structured_lyrics_payload, StructuredLyricsPayload};
use super::tags::{extract_detail_metadata, extract_embedded_lyrics, read_tagged_file_from_path};
use super::types::SongDetail;
use crate::database::DbState;
use crate::error::CommandError;
use rusqlite::{params, OptionalExtension};
use std::fs;
use std::path::{Component, Path};
use std::process::Command;
use tauri::State;

use super::utils::normalize_path;

fn read_sidecar_lrc(path_obj: &Path) -> Option<String> {
    let stem = path_obj.file_stem()?.to_string_lossy().to_string();
    let parent = path_obj.parent()?;

    let exact_path = parent.join(format!("{}.lrc", stem));
    if let Ok(content) = fs::read_to_string(&exact_path) {
        return Some(content);
    }

    let entries = fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path();
        if !candidate.is_file() {
            continue;
        }

        let ext_is_lrc = candidate
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lrc"))
            .unwrap_or(false);
        if !ext_is_lrc {
            continue;
        }

        let candidate_stem = candidate.file_stem()?.to_string_lossy().to_string();
        if !candidate_stem.eq_ignore_ascii_case(&stem) {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&candidate) {
            return Some(content);
        }
    }

    None
}

fn sync_moved_song_paths(
    conn: &mut rusqlite::Connection,
    moved_paths: &[(String, String)],
) -> Result<(), String> {
    if moved_paths.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut update_song_stmt = tx
            .prepare("UPDATE songs SET path = ?1 WHERE path = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_history_stmt = tx
            .prepare("UPDATE play_history SET song_path = ?1 WHERE song_path = ?2")
            .map_err(|e| e.to_string())?;

        for (old_path, new_path) in moved_paths {
            update_song_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update song path '{}': {}", old_path, e))?;
            update_history_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update play history '{}': {}", old_path, e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

fn read_song_lyrics_raw(path: &str) -> String {
    if let Ok(tagged_file) = read_tagged_file_from_path(Path::new(path)) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return lyrics;
        }
    }

    let path_obj = Path::new(path);
    if let Some(content) = read_sidecar_lrc(path_obj) {
        return content;
    }

    String::new()
}

#[tauri::command]
pub async fn get_song_lyrics(path: String) -> Result<String, String> {
    Ok(read_song_lyrics_raw(&path))
}

#[tauri::command]
pub async fn get_song_lyrics_payload(path: String) -> Result<StructuredLyricsPayload, String> {
    Ok(build_structured_lyrics_payload(read_song_lyrics_raw(&path)))
}

#[tauri::command]
pub async fn get_song_detail(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<SongDetail, String> {
    let normalized_path = normalize_path(&path);
    let path_obj = Path::new(&path);
    let mut detail = SongDetail {
        path: normalized_path.clone(),
        ..SongDetail::default()
    };

    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if let Some((container, codec, file_size)) = conn
            .query_row(
                "SELECT container, codec, file_size FROM songs WHERE path = ?1 LIMIT 1",
                params![&normalized_path],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            detail.container = container.filter(|value| !value.trim().is_empty());
            detail.codec = codec.filter(|value| !value.trim().is_empty());
            detail.file_size = file_size.and_then(|value| u64::try_from(value).ok());
        }
    }

    if let Ok(metadata) = fs::metadata(path_obj) {
        detail.file_size = Some(metadata.len());
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        let tag_detail = extract_detail_metadata(&tagged_file);
        detail.genre = tag_detail.genre;
        detail.year = tag_detail.year;
        detail.track_number = tag_detail.track_number;
        detail.disc_number = tag_detail.disc_number;
        detail.comment = tag_detail.comment;

        if detail.container.is_none() {
            detail.container = path_obj
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase());
        }
    }

    Ok(detail)
}

#[tauri::command]
pub fn batch_move_music_files(
    paths: Vec<String>,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<u32, CommandError> {
    let mut success_count = 0;
    let target = Path::new(&target_folder);
    let mut moved_paths: Vec<(String, String)> = Vec::new();
    if !target.exists() || !target.is_dir() {
        return Err(CommandError::new("TARGET_NOT_FOUND", "目标文件夹不存在"));
    }
    for path_str in paths {
        let src = Path::new(&path_str);
        if let Some(file_name) = src.file_name() {
            let dest = target.join(file_name);
            if fs::rename(src, &dest).is_ok() {
                success_count += 1;
                moved_paths.push((
                    normalize_path(&path_str),
                    normalize_path(&dest.to_string_lossy()),
                ));
            }
        }
    }
    if !moved_paths.is_empty() {
        let mut conn = db_state
            .conn
            .lock()
            .map_err(|e| CommandError::new("DB_LOCK_FAILED", &e.to_string()))?;
        sync_moved_song_paths(&mut conn, &moved_paths)
            .map_err(|e| CommandError::new("DB_SYNC_FAILED", &e))?;
    }

    Ok(success_count)
}

#[tauri::command]
pub fn move_music_file(
    old_path: String,
    new_path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let src = Path::new(&old_path);
    let dest = Path::new(&new_path);
    if !src.exists() {
        return Err("源文件不存在".to_string());
    }
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(src, dest).map_err(|e| e.to_string())?;
    let normalized_old_path = normalize_path(&old_path);
    let normalized_new_path = normalize_path(&dest.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    sync_moved_song_paths(&mut conn, &[(normalized_old_path, normalized_new_path)])?;
    Ok(())
}

#[tauri::command]
pub fn show_in_folder(path: String) {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .unwrap_or_else(|_| {
                println!("Failed");
                child_dummy()
            });
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .unwrap_or_else(|_| {
                println!("Failed");
                child_dummy()
            });
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            Command::new("xdg-open").arg(parent).spawn().ok();
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn child_dummy() -> std::process::Child {
    Command::new("true").spawn().unwrap()
}

#[tauri::command]
pub fn delete_music_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(path: String) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(parent_path: String, folder_name: String) -> Result<String, String> {
    let trimmed_name = folder_name.trim();
    if trimmed_name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let mut components = Path::new(trimmed_name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err("Folder name contains invalid path characters".to_string()),
    }

    let parent = Path::new(&parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Err("Parent folder does not exist".to_string());
    }

    let new_folder_path = parent.join(trimmed_name);
    if new_folder_path.exists() {
        return Err("Folder already exists".to_string());
    }

    fs::create_dir(&new_folder_path).map_err(|e| e.to_string())?;

    Ok(normalize_path(&new_folder_path.to_string_lossy()))
}

#[tauri::command]
pub fn move_file_to_folder(
    source_path: String,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let source = Path::new(&source_path);
    let filename = source.file_name().ok_or("Invalid source filename")?;
    let target = Path::new(&target_folder).join(filename);

    if target.exists() {
        return Err("Target file already exists".to_string());
    }

    fs::rename(source, &target).map_err(|e| e.to_string())?;
    let normalized_source = normalize_path(&source_path);
    let normalized_target = normalize_path(&target.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    sync_moved_song_paths(&mut conn, &[(normalized_source, normalized_target)])
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}
