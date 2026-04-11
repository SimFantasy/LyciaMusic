use crate::database::DbState;
use crate::music::utils::{format_distribution_bucket, is_lossless_audio, normalize_path};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

// =====================================================
// 辅助函数
// =====================================================

/// 判断是否为无效的专辑/歌手名（用于统计时排除）
fn is_invalid_name(name: &str) -> bool {
    let normalized = name.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "未知"
        || normalized == "未知专辑"
        || normalized == "未知歌手"
        || normalized == "unknown"
        || normalized == "unknown album"
        || normalized == "unknown artist"
}

/// 判断是否为 Hi-Res (24bit + >=48kHz)
fn is_hires(bit_depth: Option<i64>, sample_rate: i64) -> bool {
    bit_depth.unwrap_or(0) >= 24 && sample_rate >= 48000
}

// =====================================================
// 曲库统计
// =====================================================

/// 曲库统计结果（简化版）
#[derive(Serialize)]
pub struct LibraryStats {
    pub total_songs: i64,
    pub total_duration: i64,   // 秒
    pub total_file_size: i64,  // 字节
    pub album_count: i64,      // 专辑数（排除空/未知）
    pub artist_count: i64,     // 歌手数（排除空/未知）
    pub lossless_count: i64,   // 无损数量
    pub hires_count: i64,      // Hi-Res 数量 (24bit + >=48k)
    pub this_month_added: i64, // 本月首次入库数量
}

/// 音质分布统计
#[derive(Serialize)]
pub struct QualityDistribution {
    pub hires: i64,         // Hi-Res (24bit + >=48kHz 无损)
    pub super_quality: i64, // SQ (普通无损)
    pub high_quality: i64,  // HQ (有损 >= 256kbps)
    pub other: i64,         // 其他
}

/// 文件格式分布统计
#[derive(Serialize)]
pub struct FormatDistribution {
    pub flac: i64,
    pub mp3: i64,
    pub alac: i64,
    pub wav: i64,
    pub aiff: i64,
    pub aac: i64,
    pub ogg: i64,
    pub other: i64,
}

/// 获取文件格式分布统计
#[tauri::command]
pub fn get_format_distribution(db: State<DbState>) -> Result<FormatDistribution, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT format, container, codec FROM songs")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, Option<String>>(1).ok().flatten(),
                row.get::<_, Option<String>>(2).ok().flatten(),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut flac = 0i64;
    let mut mp3 = 0i64;
    let mut alac = 0i64;
    let mut wav = 0i64;
    let mut aiff = 0i64;
    let mut aac = 0i64;
    let mut ogg = 0i64;
    let mut other = 0i64;

    for row in rows.flatten() {
        match format_distribution_bucket(row.1.as_deref(), row.2.as_deref(), &row.0) {
            "flac" => flac += 1,
            "mp3" => mp3 += 1,
            "alac" => alac += 1,
            "wav" => wav += 1,
            "aiff" => aiff += 1,
            "aac" => aac += 1,
            "ogg" => ogg += 1,
            _ => other += 1,
        }
    }

    Ok(FormatDistribution {
        flac,
        mp3,
        alac,
        wav,
        aiff,
        aac,
        ogg,
        other,
    })
}

/// 获取音质分布统计
#[tauri::command]
pub fn get_quality_distribution(db: State<DbState>) -> Result<QualityDistribution, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT format, codec, bit_depth, sample_rate, bitrate FROM songs")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, Option<String>>(1).ok().flatten(),
                row.get::<_, Option<i64>>(2).ok().flatten(),
                row.get::<_, i64>(3).unwrap_or(0),
                row.get::<_, i64>(4).unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut hires = 0i64;
    let mut super_quality = 0i64;
    let mut high_quality = 0i64;
    let mut other = 0i64;

    for row in rows.flatten() {
        let (format, codec, bit_depth, sample_rate, bitrate) = row;
        let is_lossless = is_lossless_audio(codec.as_deref(), &format);
        let is_hr = is_hires(bit_depth, sample_rate);

        if is_lossless && is_hr {
            hires += 1;
        } else if is_lossless {
            super_quality += 1;
        } else if bitrate >= 256 {
            high_quality += 1;
        } else {
            other += 1;
        }
    }

    Ok(QualityDistribution {
        hires,
        super_quality,
        high_quality,
        other,
    })
}

/// 获取曲库统计（全库，无 scope/time_range 参数）
#[tauri::command]
pub fn get_library_stats(db: State<DbState>) -> Result<LibraryStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 基础统计
    let (total_songs, total_duration, total_file_size): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0) FROM songs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    // 专辑数（排除空/未知）- 在 Rust 端过滤
    let album_count: i64 = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT album FROM songs WHERE album IS NOT NULL AND album != ''")
            .map_err(|e| e.to_string())?;
        let albums: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|name: &String| !is_invalid_name(name))
            .collect();
        albums.len() as i64
    };

    // 歌手数（排除空/未知）
    let artist_count: i64 = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT artist FROM songs WHERE artist IS NOT NULL AND artist != ''")
            .map_err(|e| e.to_string())?;
        let artists: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|name: &String| !is_invalid_name(name))
            .collect();
        artists.len() as i64
    };

    // 无损数量 + Hi-Res 数量
    let (lossless_count, hires_count): (i64, i64) = {
        let mut stmt = conn
            .prepare("SELECT format, codec, bit_depth, sample_rate FROM songs")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, Option<String>>(1).ok().flatten(),
                    row.get::<_, Option<i64>>(2).ok().flatten(),
                    row.get::<_, i64>(3).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut lossless = 0i64;
        let mut hires = 0i64;
        for row in rows.flatten() {
            if is_lossless_audio(row.1.as_deref(), &row.0) {
                lossless += 1;
                if is_hires(row.2, row.3) {
                    hires += 1;
                }
            }
        }
        (lossless, hires)
    };

    // 本月首次入库数量
    let this_month_added: i64 = {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        // 简化：30天内入库
        let month_start = now - 30 * 24 * 60 * 60;
        conn.query_row(
            "SELECT COUNT(*) FROM songs WHERE added_at >= ?1",
            [month_start],
            |row| row.get(0),
        )
        .unwrap_or(0)
    };

    Ok(LibraryStats {
        total_songs,
        total_duration,
        total_file_size,
        album_count,
        artist_count,
        lossless_count,
        hires_count,
        this_month_added,
    })
}

// =====================================================
// 播放历史与行为统计
// =====================================================

/// 时间范围（用于行为统计）
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TimeRange {
    All,
    Days7,
    Days30,
    ThisYear,
}

impl TimeRange {
    fn to_timestamp_from(&self) -> Option<i64> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        match self {
            TimeRange::All => None,
            TimeRange::Days7 => Some(now - 7 * 24 * 60 * 60),
            TimeRange::Days30 => Some(now - 30 * 24 * 60 * 60),
            TimeRange::ThisYear => Some(now - 365 * 24 * 60 * 60),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryEntry {
    pub song_path: String,
    pub played_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryImportEntry {
    pub song_path: String,
    pub played_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAlbumCatalogItem {
    pub key: String,
    pub name: String,
    pub artist: String,
    pub played_at: i64,
    pub first_song_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlaylistCatalogItem {
    pub id: String,
    pub name: String,
    pub count: u32,
    pub played_at: i64,
    pub first_song_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistImportItem {
    pub id: String,
    pub name: String,
    pub song_paths: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SongPathSortMode {
    Title,
    Artist,
    AddedAt,
    AddedAtAsc,
    FileModifiedAt,
    FileModifiedAtAsc,
}

#[derive(Debug)]
struct SongCatalogRow {
    path: String,
    artist: String,
    artist_names: Vec<String>,
    effective_artist_names: Vec<String>,
    album: String,
    album_artist: String,
    album_key: String,
}

#[derive(Debug)]
struct SongViewRow {
    path: String,
    title: String,
    artist: String,
    artist_names: Vec<String>,
    effective_artist_names: Vec<String>,
    album: String,
    album_artist: String,
    album_key: String,
    added_at: Option<i64>,
    file_modified_at: Option<i64>,
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn preferred_artist_names(row: &SongCatalogRow) -> Vec<String> {
    if !row.effective_artist_names.is_empty() {
        return row.effective_artist_names.clone();
    }

    if !row.artist_names.is_empty() {
        return row.artist_names.clone();
    }

    vec![row.artist.clone()]
}

fn preferred_view_artist_names(row: &SongViewRow) -> Vec<String> {
    if !row.effective_artist_names.is_empty() {
        return row.effective_artist_names.clone();
    }

    if !row.artist_names.is_empty() {
        return row.artist_names.clone();
    }

    vec![row.artist.clone()]
}

fn resolve_album_key(row: &SongCatalogRow) -> String {
    if !row.album_key.trim().is_empty() {
        return row.album_key.clone();
    }

    let album = if row.album.trim().is_empty() {
        "unknown".to_string()
    } else {
        row.album.to_ascii_lowercase()
    };
    let artist = if row.album_artist.trim().is_empty() && row.artist.trim().is_empty() {
        "unknown".to_string()
    } else if row.album_artist.trim().is_empty() {
        row.artist.to_ascii_lowercase()
    } else {
        row.album_artist.to_ascii_lowercase()
    };

    format!(
        "{}::{}",
        album,
        artist,
    )
}

fn resolve_view_album_key(row: &SongViewRow) -> String {
    if !row.album_key.trim().is_empty() {
        return row.album_key.clone();
    }

    let album = if row.album.trim().is_empty() {
        "unknown".to_string()
    } else {
        row.album.to_ascii_lowercase()
    };
    let artist = if row.album_artist.trim().is_empty() && row.artist.trim().is_empty() {
        "unknown".to_string()
    } else if row.album_artist.trim().is_empty() {
        row.artist.to_ascii_lowercase()
    } else {
        row.album_artist.to_ascii_lowercase()
    };

    format!("{album}::{artist}")
}

fn path_file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn song_title_label(row: &SongViewRow) -> String {
    if row.title.trim().is_empty() {
        path_file_name(&row.path)
    } else {
        row.title.clone()
    }
}

fn song_matches_query(row: &SongViewRow, query: &str) -> bool {
    let lowered_query = query.trim().to_lowercase();
    if lowered_query.is_empty() {
        return true;
    }

    path_file_name(&row.path).to_lowercase().contains(&lowered_query)
        || row.title.to_lowercase().contains(&lowered_query)
        || row.artist.to_lowercase().contains(&lowered_query)
        || row.album.to_lowercase().contains(&lowered_query)
        || row.album_artist.to_lowercase().contains(&lowered_query)
        || preferred_view_artist_names(row)
            .iter()
            .any(|name| name.to_lowercase().contains(&lowered_query))
}

fn song_has_artist(row: &SongViewRow, artist_name: &str) -> bool {
    preferred_view_artist_names(row)
        .iter()
        .any(|name| name == artist_name)
}

fn sort_song_view_rows(rows: &mut [SongViewRow], sort_mode: &SongPathSortMode) {
    rows.sort_by(|left, right| match sort_mode {
        SongPathSortMode::Title => song_title_label(left)
            .to_lowercase()
            .cmp(&song_title_label(right).to_lowercase()),
        SongPathSortMode::Artist => left
            .artist
            .to_lowercase()
            .cmp(&right.artist.to_lowercase())
            .then_with(|| song_title_label(left).to_lowercase().cmp(&song_title_label(right).to_lowercase())),
        SongPathSortMode::AddedAt => right
            .added_at
            .unwrap_or_default()
            .cmp(&left.added_at.unwrap_or_default())
            .then_with(|| song_title_label(left).to_lowercase().cmp(&song_title_label(right).to_lowercase())),
        SongPathSortMode::AddedAtAsc => left
            .added_at
            .unwrap_or_default()
            .cmp(&right.added_at.unwrap_or_default())
            .then_with(|| song_title_label(left).to_lowercase().cmp(&song_title_label(right).to_lowercase())),
        SongPathSortMode::FileModifiedAt => right
            .file_modified_at
            .unwrap_or_default()
            .cmp(&left.file_modified_at.unwrap_or_default())
            .then_with(|| song_title_label(left).to_lowercase().cmp(&song_title_label(right).to_lowercase())),
        SongPathSortMode::FileModifiedAtAsc => left
            .file_modified_at
            .unwrap_or_default()
            .cmp(&right.file_modified_at.unwrap_or_default())
            .then_with(|| song_title_label(left).to_lowercase().cmp(&song_title_label(right).to_lowercase())),
    });
}

fn load_song_catalog_row(
    conn: &rusqlite::Connection,
    normalized_path: &str,
) -> Result<Option<SongCatalogRow>, String> {
    conn.query_row(
        "SELECT path, artist, artist_names, effective_artist_names, album, album_artist, album_key
         FROM songs
         WHERE path = ?1",
        [normalized_path],
        |row| {
            Ok(SongCatalogRow {
                path: row.get::<_, String>(0)?,
                artist: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist_names: deserialize_string_list(row.get::<_, Option<String>>(2)?),
                effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
                album: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn load_song_view_row(
    conn: &rusqlite::Connection,
    normalized_path: &str,
) -> Result<Option<SongViewRow>, String> {
    conn.query_row(
        "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, added_at, file_modified_at
         FROM songs
         WHERE path = ?1",
        [normalized_path],
        |row| {
            Ok(SongViewRow {
                path: row.get::<_, String>(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
                effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(4)?),
                album: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                added_at: row.get::<_, Option<i64>>(8)?,
                file_modified_at: row.get::<_, Option<i64>>(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn lookup_song_id(conn: &rusqlite::Connection, normalized_path: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM songs WHERE path = ?1",
        [normalized_path],
        |row| row.get(0),
    )
    .ok()
}

fn insert_history_event(
    conn: &rusqlite::Connection,
    normalized_path: &str,
    played_at: i64,
    played_seconds: i64,
    event: &str,
) -> Result<(), String> {
    let song_id = match lookup_song_id(conn, normalized_path) {
        Some(id) => id,
        None => return Ok(()),
    };

    conn.execute(
        "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![normalized_path, song_id, played_at, played_seconds, event],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn add_to_history(db: State<DbState>, song_path: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let normalized_path = normalize_path(&song_path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    insert_history_event(&conn, &normalized_path, now, 0, "recent")
}

#[tauri::command]
pub fn import_recent_history(
    db: State<DbState>,
    entries: Vec<RecentHistoryImportEntry>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }

    let mut deduped = std::collections::HashMap::<String, i64>::new();
    for entry in entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = deduped.entry(normalized_path).or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (song_path, played_at) in deduped {
        insert_history_event(&tx, &song_path, played_at, 0, "recent")?;
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_history(
    db: State<DbState>,
    limit: Option<usize>,
) -> Result<Vec<RecentHistoryEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let max_rows = limit.unwrap_or(1000).clamp(1, 5000) as i64;

    let mut stmt = conn
        .prepare(
            "SELECT s.path, MAX(ph.played_at) AS played_at
             FROM play_history ph
             INNER JOIN songs s ON ph.song_id = s.id
             WHERE ph.event = 'recent'
             GROUP BY ph.song_id
             ORDER BY played_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([max_rows], |row| {
            Ok(RecentHistoryEntry {
                song_path: row.get(0)?,
                played_at: row.get::<_, i64>(1)? * 1000,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|row| row.ok()).collect())
}

#[tauri::command]
pub fn get_favorite_artist_catalog(
    db: State<DbState>,
    favorite_paths: Vec<String>,
) -> Result<Vec<crate::music::types::ArtistCatalogItem>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, (u32, String)>::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        for artist_name in preferred_artist_names(&row) {
            let key = if artist_name.trim().is_empty() {
                "Unknown".to_string()
            } else {
                artist_name
            };
            let entry = map.entry(key).or_insert((0, row.path.clone()));
            entry.0 = entry.0.saturating_add(1);
        }
    }

    let mut result: Vec<crate::music::types::ArtistCatalogItem> = map
        .into_iter()
        .map(|(name, (count, first_song_path))| crate::music::types::ArtistCatalogItem {
            name,
            count,
            first_song_path,
        })
        .collect();

    result.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub fn get_favorite_album_catalog(
    db: State<DbState>,
    favorite_paths: Vec<String>,
) -> Result<Vec<crate::music::types::AlbumCatalogItem>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, crate::music::types::AlbumCatalogItem>::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        let key = resolve_album_key(&row);
        let existing = map.entry(key.clone()).or_insert(crate::music::types::AlbumCatalogItem {
            key,
            name: if row.album.trim().is_empty() {
                "Unknown".to_string()
            } else {
                row.album.clone()
            },
            count: 0,
            artist: if row.album_artist.trim().is_empty() {
                if row.artist.trim().is_empty() {
                    "Unknown".to_string()
                } else {
                    row.artist.clone()
                }
            } else {
                row.album_artist.clone()
            },
            first_song_path: row.path.clone(),
        });

        existing.count = existing.count.saturating_add(1);
    }

    let mut result: Vec<crate::music::types::AlbumCatalogItem> = map.into_values().collect();
    result.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub fn get_recent_album_catalog(
    db: State<DbState>,
    recent_entries: Vec<RecentHistoryImportEntry>,
) -> Result<Vec<RecentAlbumCatalogItem>, String> {
    if recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, RecentAlbumCatalogItem>::new();

    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        let key = resolve_album_key(&row);
        let played_at = entry.played_at;

        match map.get_mut(&key) {
            Some(existing) if played_at > existing.played_at => {
                existing.played_at = played_at;
                existing.first_song_path = row.path.clone();
            }
            Some(_) => {}
            None => {
                map.insert(
                    key.clone(),
                    RecentAlbumCatalogItem {
                        key,
                        name: if row.album.trim().is_empty() {
                            "Unknown".to_string()
                        } else {
                            row.album.clone()
                        },
                        artist: if row.album_artist.trim().is_empty() {
                            if row.artist.trim().is_empty() {
                                "Unknown".to_string()
                            } else {
                                row.artist.clone()
                            }
                        } else {
                            row.album_artist.clone()
                        },
                        played_at,
                        first_song_path: row.path.clone(),
                    },
                );
            }
        }
    }

    let mut result: Vec<RecentAlbumCatalogItem> = map.into_values().collect();
    result.sort_by(|a, b| b.played_at.cmp(&a.played_at));
    Ok(result)
}

#[tauri::command]
pub fn get_favorite_song_paths_view(
    db: State<DbState>,
    favorite_paths: Vec<String>,
    query: Option<String>,
    sort_mode: SongPathSortMode,
    detail_filter_type: Option<String>,
    detail_filter_value: Option<String>,
) -> Result<Vec<String>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lowered_query = query.map(|value| value.trim().to_lowercase());
    let normalized_filter_type = detail_filter_type
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let normalized_filter_value = detail_filter_value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut rows: Vec<SongViewRow> = Vec::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_view_row(&conn, &normalized_path)? else {
            continue;
        };

        let matches_detail_filter = match (
            normalized_filter_type.as_deref(),
            normalized_filter_value.as_deref(),
        ) {
            (Some("artist"), Some(filter_value)) => song_has_artist(&row, filter_value),
            (Some("album"), Some(filter_value)) => resolve_view_album_key(&row) == filter_value,
            _ => true,
        };

        if !matches_detail_filter {
            continue;
        }

        let matches_search = lowered_query
            .as_deref()
            .map(|value| song_matches_query(&row, value))
            .unwrap_or(true);

        if matches_search {
            rows.push(row);
        }
    }

    sort_song_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|row| row.path).collect())
}

#[tauri::command]
pub fn get_recent_song_paths_view(
    db: State<DbState>,
    recent_entries: Vec<RecentHistoryImportEntry>,
    query: Option<String>,
    sort_mode: SongPathSortMode,
) -> Result<Vec<String>, String> {
    if recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lowered_query = query.map(|value| value.trim().to_lowercase());
    let mut latest_entries = HashMap::<String, i64>::new();

    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = latest_entries
            .entry(normalized_path)
            .or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut rows: Vec<SongViewRow> = Vec::new();
    for normalized_path in latest_entries.into_keys() {
        let Some(row) = load_song_view_row(&conn, &normalized_path)? else {
            continue;
        };

        let matches_search = lowered_query
            .as_deref()
            .map(|value| song_matches_query(&row, value))
            .unwrap_or(true);

        if matches_search {
            rows.push(row);
        }
    }

    sort_song_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|row| row.path).collect())
}

#[tauri::command]
pub fn get_recent_playlist_catalog(
    playlists: Vec<PlaylistImportItem>,
    recent_entries: Vec<RecentHistoryImportEntry>,
) -> Result<Vec<RecentPlaylistCatalogItem>, String> {
    if playlists.is_empty() || recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let mut latest_played_at_by_path = HashMap::<String, i64>::new();
    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = latest_played_at_by_path
            .entry(normalized_path)
            .or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut result = Vec::new();

    for playlist in playlists {
        let mut last_played_time = 0;

        for path in &playlist.song_paths {
            let normalized_path = normalize_path(path);
            if let Some(played_at) = latest_played_at_by_path.get(&normalized_path) {
                if *played_at > last_played_time {
                    last_played_time = *played_at;
                }
            }
        }

        if last_played_time <= 0 {
            continue;
        }

        result.push(RecentPlaylistCatalogItem {
            id: playlist.id,
            name: playlist.name,
            count: playlist.song_paths.len().min(u32::MAX as usize) as u32,
            played_at: last_played_time,
            first_song_path: playlist.song_paths.first().cloned().unwrap_or_default(),
        });
    }

    result.sort_by(|a, b| b.played_at.cmp(&a.played_at));
    Ok(result)
}

#[tauri::command]
pub fn remove_from_recent_history(
    db: State<DbState>,
    song_paths: Vec<String>,
) -> Result<(), String> {
    if song_paths.is_empty() {
        return Ok(());
    }

    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut stmt = tx
        .prepare("DELETE FROM play_history WHERE event = 'recent' AND song_path = ?1")
        .map_err(|e| e.to_string())?;

    for song_path in song_paths {
        let normalized_path = normalize_path(&song_path);
        if normalized_path.is_empty() {
            continue;
        }
        stmt.execute([normalized_path]).map_err(|e| e.to_string())?;
    }

    drop(stmt);
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_recent_history(db: State<DbState>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM play_history WHERE event = 'recent'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 记录一次播放事件（通过 song_path 查找 song_id）
#[tauri::command]
pub fn record_play(db: State<DbState>, song_path: String, duration: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 规范化路径，确保与数据库中的路径格式一致
    let normalized_path = normalize_path(&song_path);

    // 通过 path 查找 song_id
    let song_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM songs WHERE path = ?1",
            [&normalized_path],
            |row| row.get(0),
        )
        .ok();

    // 如果找不到歌曲，静默返回（歌曲可能已删除）
    let song_id = match song_id {
        Some(id) => id,
        None => return Ok(()),
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, 'play')",
        rusqlite::params![&normalized_path, song_id, now, duration],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 行为统计结果
#[derive(Serialize)]
pub struct BehaviorStats {
    pub total_plays: i64,
    pub total_duration: i64,
    pub top_songs: Vec<TopSong>,
    pub top_songs_by_duration: Vec<TopSong>,
    pub top_artists: Vec<TopArtist>,
    pub top_albums: Vec<TopAlbum>,
    pub hour_distribution: Vec<i64>,
    pub recent_activity: Vec<i64>,
}

#[derive(Serialize)]
pub struct TopSong {
    pub song_path: String,
    pub play_count: i64,
    pub value: i64,
}

#[derive(Serialize)]
pub struct TopArtist {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Serialize)]
pub struct TopAlbum {
    pub album: String,
    pub play_count: i64,
}

/// 获取行为统计（全库，JOIN songs 表过滤有效歌曲）
#[tauri::command]
pub fn get_behavior_stats(
    db: State<DbState>,
    time_range: TimeRange,
) -> Result<BehaviorStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 构建时间条件
    let time_condition = match time_range.to_timestamp_from() {
        Some(from) => format!("AND ph.played_at >= {}", from),
        None => String::new(),
    };

    // 只统计 song_id 非空且在 songs 表中存在的记录
    let base_join = "FROM play_history ph INNER JOIN songs s ON ph.song_id = s.id";

    // 指标 A1: 播放次数
    let sql_plays = format!(
        "SELECT COUNT(*) {} WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {}",
        base_join, time_condition
    );
    let total_plays: i64 = conn
        .query_row(&sql_plays, [], |row| row.get(0))
        .unwrap_or(0);

    // 指标 A2: 播放总时长
    let sql_duration = format!(
        "SELECT COALESCE(SUM(ph.played_seconds), 0) {} WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {}",
        base_join, time_condition
    );
    let total_duration: i64 = conn
        .query_row(&sql_duration, [], |row| row.get(0))
        .unwrap_or(0);

    // 指标 B1: Top 5 歌曲 (按次数)
    let sql_top_plays = format!(
        "SELECT s.path, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY ph.song_id 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_songs: Vec<TopSong> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_plays).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let count: i64 = row.get(1)?;
                Ok(TopSong {
                    song_path: row.get(0)?,
                    play_count: count,
                    value: count,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_songs.push(row);
        }
    }

    // 指标 B2: Top 5 歌曲 (按时长)
    let sql_top_duration = format!(
        "SELECT s.path, COALESCE(SUM(ph.played_seconds), 0) as duration 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY ph.song_id 
         ORDER BY duration DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_songs_by_duration: Vec<TopSong> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_duration).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let duration: i64 = row.get(1)?;
                Ok(TopSong {
                    song_path: row.get(0)?,
                    play_count: 0,
                    value: duration,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_songs_by_duration.push(row);
        }
    }

    // 指标 C: 小时分布
    let sql_hours = format!(
        "SELECT CAST(strftime('%H', ph.played_at, 'unixepoch', 'localtime') AS INTEGER) as hour, 
                COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY hour",
        base_join, time_condition
    );
    let mut hour_distribution: Vec<i64> = vec![0; 24];
    {
        let mut stmt = conn.prepare(&sql_hours).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            if row.0 >= 0 && row.0 < 24 {
                hour_distribution[row.0 as usize] = row.1;
            }
        }
    }

    // 指标 D1: Top 5 歌手
    let sql_top_artists = format!(
        "SELECT TRIM(s.artist) as artist, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.artist IS NOT NULL 
           AND TRIM(s.artist) != '' 
           AND LOWER(TRIM(s.artist)) NOT IN ('未知', '未知歌手', 'unknown', 'unknown artist') 
         GROUP BY TRIM(s.artist) 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_artists: Vec<TopArtist> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_artists).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TopArtist {
                    artist: row.get(0)?,
                    play_count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_artists.push(row);
        }
    }

    // 指标 D2: Top 5 专辑
    let sql_top_albums = format!(
        "SELECT TRIM(s.album) as album, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.album IS NOT NULL 
           AND TRIM(s.album) != '' 
           AND LOWER(TRIM(s.album)) NOT IN ('未知', '未知专辑', 'unknown', 'unknown album') 
         GROUP BY TRIM(s.album) 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_albums: Vec<TopAlbum> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_albums).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TopAlbum {
                    album: row.get(0)?,
                    play_count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_albums.push(row);
        }
    }

    // 指标 E: 最近 7 天播放趋势 (Timeline)
    // 即使 time_range 不是 7Days，我们也始终返回最近 7 天的趋势供 UI 显示
    let mut recent_activity: Vec<i64> = vec![0; 7];
    {
        // 算出 7 天前的零点时间戳 (简化处理，按 24h 倒推)
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let day_seconds = 24 * 60 * 60;
        let start_time = now - 7 * day_seconds;

        // 查询最近 7 天的每一天的播放时长
        // Output: day_offset (0-6), total_duration
        let sql_activity = format!(
            "SELECT CAST((ph.played_at - {}) / {} AS INTEGER) as day_offset, 
                    COALESCE(SUM(ph.played_seconds), 0) as duration 
             FROM play_history ph 
             INNER JOIN songs s ON ph.song_id = s.id 
             WHERE ph.played_at >= {} AND ph.event = 'play' AND ph.song_id IS NOT NULL 
             GROUP BY day_offset",
            start_time, day_seconds, start_time
        );

        let mut stmt = conn.prepare(&sql_activity).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let offset = row.0;
            if offset >= 0 && offset < 7 {
                recent_activity[offset as usize] = row.1;
            }
        }
    }

    Ok(BehaviorStats {
        total_plays,
        total_duration,
        top_songs,
        top_songs_by_duration,
        top_artists,
        top_albums,
        hour_distribution,
        recent_activity,
    })
}
