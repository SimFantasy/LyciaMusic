use super::super::types::Song;
use super::super::utils::{
    descendant_like_patterns, is_supported_library_extension, normalize_path,
};
use super::parser::{
    enrich_album_groups, parse_song_from_file, preferred_parse_workers, song_identity_missing,
    song_metadata_incomplete,
};
use super::progress::ScanProgressReporter;
use super::{
    clamp_i64_to_u32, deserialize_string_list, i64_to_bool, i64_to_u64_opt, i64_to_u8_opt,
};
use rayon::prelude::*;
use rusqlite::params;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub(super) struct DbSongSnapshot {
    pub(super) song: Song,
    pub(super) file_modified_at: Option<i64>,
    pub(super) file_size: i64,
}

pub(super) struct ScanDiff {
    pub(super) songs: Vec<Song>,
    pub(super) to_add: Vec<Song>,
    pub(super) to_update: Vec<Song>,
    pub(super) to_delete: Vec<String>,
    pub(super) has_disk_songs: bool,
}

struct DiskCandidate {
    index: usize,
    path: PathBuf,
    path_str: String,
    ext: String,
    disk_mtime: Option<i64>,
    disk_size: i64,
}

struct ParseTask {
    index: usize,
    path: PathBuf,
    path_str: String,
    ext: String,
    is_add: bool,
}

struct ParsedTaskResult {
    index: usize,
    song: Song,
    is_add: bool,
}

pub(super) fn load_db_snapshot_for_folder(
    conn: &rusqlite::Connection,
    normalized_folder: &str,
) -> Result<HashMap<String, DbSongSnapshot>, String> {
    let (pattern_forward, pattern_back) = descendant_like_patterns(normalized_folder);
    let mut snapshot = HashMap::new();

    let mut stmt = conn
        .prepare(
            "SELECT id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at
             FROM songs
             WHERE path = ?1
                OR path LIKE ?2 ESCAPE '^'
                OR path LIKE ?3 ESCAPE '^'",
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map(
            params![normalized_folder, pattern_forward, pattern_back],
            |row| {
                let path: String = row.get(1)?;
                let duration = clamp_i64_to_u32(row.get::<_, Option<i64>>(11)?.unwrap_or(0));
                let bitrate = clamp_i64_to_u32(row.get::<_, Option<i64>>(12)?.unwrap_or(0));
                let sample_rate = clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0));
                let bit_depth = i64_to_u8_opt(row.get::<_, Option<i64>>(14)?);
                let file_size_i64 = row.get::<_, Option<i64>>(18)?.unwrap_or(0).max(0);
                let track_number = row.get::<_, Option<String>>(19)?;
                let disc_number = row.get::<_, Option<String>>(20)?;
                let added_at_i64 = row.get::<_, Option<i64>>(21)?;
                let file_modified_at_i64 = row.get::<_, Option<i64>>(22)?;
                let artist_names = deserialize_string_list(row.get::<_, Option<String>>(4)?);
                let effective_artist_names =
                    deserialize_string_list(row.get::<_, Option<String>>(5)?);

                let name = Path::new(&path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());

                Ok((
                    path.clone(),
                    DbSongSnapshot {
                        file_modified_at: file_modified_at_i64,
                        file_size: file_size_i64,
                        song: Song {
                            id: row.get::<_, i64>(0).ok(),
                            name,
                            path,
                            title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                            artist: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                            artist_names,
                            effective_artist_names,
                            album: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                            album_artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                            album_key: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                            is_various_artists_album: i64_to_bool(row.get::<_, Option<i64>>(9)?),
                            collapse_artist_credits: i64_to_bool(row.get::<_, Option<i64>>(10)?),
                            duration,
                            bitrate,
                            sample_rate,
                            bit_depth,
                            format: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                            container: row.get::<_, Option<String>>(16)?,
                            codec: row.get::<_, Option<String>>(17)?,
                            file_size: file_size_i64 as u64,
                            track_number,
                            disc_number,
                            added_at: i64_to_u64_opt(added_at_i64),
                            file_modified_at: i64_to_u64_opt(file_modified_at_i64),
                        },
                    },
                ))
            },
        )
        .map_err(|error| error.to_string())?;

    for row in rows.flatten() {
        snapshot.insert(row.0, row.1);
    }

    Ok(snapshot)
}

fn collect_disk_candidates(
    normalized_folder: &str,
    reporter: Option<&ScanProgressReporter>,
) -> Vec<DiskCandidate> {
    let mut candidates = Vec::new();
    let mut discovered = 0usize;

    if let Some(reporter) = reporter {
        reporter.emit_collecting(0, 0, Some("正在扫描文件夹".to_string()));
    }

    for entry in WalkDir::new(normalized_folder)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = match path.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !is_supported_library_extension(&ext) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        let raw_path_str = path.to_string_lossy().to_string();
        let path_str = normalize_path(&raw_path_str);

        discovered += 1;
        candidates.push(DiskCandidate {
            index: candidates.len(),
            path: path.to_path_buf(),
            path_str,
            ext,
            disk_mtime: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64),
            disk_size: metadata.len() as i64,
        });

        if let Some(reporter) = reporter {
            if discovered == 1 || discovered % 200 == 0 {
                reporter.emit_collecting(
                    discovered,
                    0,
                    Some(format!("已发现 {} 首候选歌曲", discovered)),
                );
            }
        }
    }

    if let Some(reporter) = reporter {
        reporter.emit_collecting(
            candidates.len(),
            candidates.len(),
            Some(format!(
                "已完成文件收集，共 {} 首候选歌曲",
                candidates.len()
            )),
        );
    }

    candidates
}

fn parse_tasks_in_parallel(
    tasks: Vec<ParseTask>,
    reporter: Option<ScanProgressReporter>,
) -> Result<Vec<ParsedTaskResult>, String> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    let total = tasks.len();
    let worker_count = preferred_parse_workers(total);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .build()
        .map_err(|error| error.to_string())?;

    let results = pool.install(|| {
        tasks
            .into_par_iter()
            .filter_map(|task| {
                let parsed = parse_song_from_file(&task.path, &task.path_str, &task.ext);

                if let Some(reporter) = reporter.as_ref() {
                    reporter.advance_parsing(total);
                }

                parsed.map(|song| ParsedTaskResult {
                    index: task.index,
                    song,
                    is_add: task.is_add,
                })
            })
            .collect()
    });

    Ok(results)
}

pub(super) fn collect_scan_diff(
    normalized_folder: &str,
    mut db_snapshot: HashMap<String, DbSongSnapshot>,
    reporter: Option<&ScanProgressReporter>,
) -> Result<ScanDiff, String> {
    let candidates = collect_disk_candidates(normalized_folder, reporter);
    let has_disk_songs = !candidates.is_empty();
    let mut songs_by_index: Vec<Option<Song>> = vec![None; candidates.len()];
    let mut parse_tasks = Vec::new();

    for candidate in &candidates {
        if let Some(db_info) = db_snapshot.remove(&candidate.path_str) {
            if db_info.file_modified_at != candidate.disk_mtime
                || db_info.file_size != candidate.disk_size
                || song_identity_missing(&db_info.song)
                || song_metadata_incomplete(&db_info.song)
            {
                parse_tasks.push(ParseTask {
                    index: candidate.index,
                    path: candidate.path.clone(),
                    path_str: candidate.path_str.clone(),
                    ext: candidate.ext.clone(),
                    is_add: false,
                });
            } else {
                songs_by_index[candidate.index] = Some(db_info.song);
            }
        } else {
            parse_tasks.push(ParseTask {
                index: candidate.index,
                path: candidate.path.clone(),
                path_str: candidate.path_str.clone(),
                ext: candidate.ext.clone(),
                is_add: true,
            });
        }
    }

    if let Some(reporter) = reporter {
        reporter.start_parsing(parse_tasks.len());
    }

    let parsed_results = parse_tasks_in_parallel(parse_tasks, reporter.cloned())?;
    let mut to_add = Vec::new();
    let mut to_update = Vec::new();

    for result in parsed_results {
        songs_by_index[result.index] = Some(result.song.clone());
        if result.is_add {
            to_add.push(result.song);
        } else {
            to_update.push(result.song);
        }
    }

    let mut songs: Vec<Song> = songs_by_index.into_iter().flatten().collect();
    let to_delete: Vec<String> = db_snapshot.keys().cloned().collect();

    enrich_album_groups(&mut songs);

    let song_by_path: HashMap<String, Song> = songs
        .iter()
        .cloned()
        .map(|song| (song.path.clone(), song))
        .collect();

    let to_add = to_add
        .into_iter()
        .map(|song| song_by_path.get(&song.path).cloned().unwrap_or(song))
        .collect();

    let to_update = to_update
        .into_iter()
        .map(|song| song_by_path.get(&song.path).cloned().unwrap_or(song))
        .collect();

    Ok(ScanDiff {
        songs,
        to_add,
        to_update,
        to_delete,
        has_disk_songs,
    })
}
