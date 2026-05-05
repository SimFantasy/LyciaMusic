use crate::database::DbState;
use crate::music::scanner::parse_song_from_file;
use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioSource, PlayerState, VISUALIZER_BAND_COUNT,
};
use crate::remote::cache::{
    ensure_cached_path, is_remote_uri, remote_playback_source, RemotePlaybackSource,
};
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

const REMOTE_LYRICS_CACHE_READY_EVENT: &str = "remote-lyrics-cache-ready";

fn normalize_cover_for_smtc(cover: &str) -> Option<String> {
    let trimmed = cover.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("file://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
    {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed.replace('/', "\\");
    Some(format!("file://{normalized}"))
}

#[tauri::command]
pub async fn play_audio(
    path: String,
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    output_mode: AudioOutputMode,
    app: tauri::AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let playback_id = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut selected_output_mode = output_mode;
    let source = if is_remote_uri(&path) {
        match remote_playback_source(&db_state, &path)? {
            RemotePlaybackSource::Cached { path } => AudioSource::LocalFile(path),
            RemotePlaybackSource::Stream(stream) => {
                selected_output_mode = AudioOutputMode::Shared;
                schedule_remote_cache_after_half(
                    app.clone(),
                    db_state.conn.clone(),
                    state.progress.clone(),
                    state.playback_id.clone(),
                    playback_id,
                    stream.remote_uri.clone(),
                    duration,
                );
                AudioSource::RemoteWebDav(stream)
            }
        }
    } else {
        AudioSource::LocalFile(path)
    };

    let normalized_cover = normalize_cover_for_smtc(&cover);
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Play {
        source,
        output_mode: selected_output_mode,
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(MediaPlayback::Playing {
                progress: Some(MediaPosition(Duration::from_secs(0))),
            });
        }
    }

    Ok(())
}

fn schedule_remote_cache_after_half(
    app: tauri::AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    progress: std::sync::Arc<crate::player::types::SharedProgress>,
    playback_id: std::sync::Arc<std::sync::atomic::AtomicU64>,
    expected_playback_id: u64,
    remote_uri: String,
    duration: u32,
) {
    tauri::async_runtime::spawn(async move {
        let threshold = if duration > 0 {
            duration as f64 * 0.5
        } else {
            30.0
        };
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if playback_id.load(Ordering::Relaxed) != expected_playback_id {
                return;
            }

            let rate = progress.sample_rate.load(Ordering::Relaxed);
            let channels = progress.channels.load(Ordering::Relaxed);
            if rate == 0 || channels == 0 {
                continue;
            }

            let samples = progress.samples_played.load(Ordering::Relaxed);
            let seconds = samples as f64 / (rate as f64 * channels as f64);
            if seconds >= threshold {
                let db_state = DbState { conn };
                if let Ok(cache_path) = ensure_cached_path(&app, &db_state, &remote_uri).await {
                    update_cached_remote_audio_metadata(&db_state, &remote_uri, &cache_path);
                    let _ = app.emit(REMOTE_LYRICS_CACHE_READY_EVENT, remote_uri.clone());
                }
                return;
            }
        }
    });
}

fn update_cached_remote_audio_metadata(db_state: &DbState, remote_uri: &str, cache_path: &str) {
    let format = remote_uri
        .rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let Some(song) = parse_song_from_file(Path::new(cache_path), remote_uri, &format) else {
        return;
    };
    if let Ok(conn) = db_state.conn.lock() {
        let _ = conn.execute(
            "UPDATE songs
             SET duration = ?1,
                 bitrate = ?2,
                 sample_rate = ?3,
                 bit_depth = ?4,
                 format = ?5,
                 container = ?6,
                 codec = ?7,
                 file_size = ?8
             WHERE path = ?9",
            rusqlite::params![
                song.duration as i64,
                song.bitrate as i64,
                song.sample_rate as i64,
                song.bit_depth.map(|value| value as i64),
                song.format,
                song.container,
                song.codec,
                song.file_size.min(i64::MAX as u64) as i64,
                remote_uri,
            ],
        );
    }
}

#[tauri::command]
pub fn update_playback_metadata(
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    is_playing: bool,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let normalized_cover = normalize_cover_for_smtc(&cover);
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(if is_playing {
                MediaPlayback::Playing {
                    progress: Some(MediaPosition(Duration::from_secs(0))),
                }
            } else {
                MediaPlayback::Paused { progress: None }
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Pause).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Paused { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Resume).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Playing { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn seek_audio(
    time: f64,
    is_playing: bool,
    request_id: u64,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Seek {
        time,
        is_playing,
        request_id,
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let progress = MediaPosition(Duration::from_secs_f64(time.max(0.0)));
            if is_playing {
                let _ = mc.set_playback(MediaPlayback::Playing {
                    progress: Some(progress),
                });
            } else {
                let _ = mc.set_playback(MediaPlayback::Paused {
                    progress: Some(progress),
                });
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_volume(volume: f32, state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetVolume(volume))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_playback_progress(state: tauri::State<PlayerState>) -> f64 {
    let samples = state.progress.samples_played.load(Ordering::Relaxed);
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    let channels = state.progress.channels.load(Ordering::Relaxed);

    if rate == 0 || channels == 0 {
        return 0.0;
    }

    let total_samples_per_sec = rate as u64 * channels as u64;
    samples as f64 / total_samples_per_sec as f64
}

#[tauri::command]
pub fn get_audio_visualizer_samples(state: tauri::State<PlayerState>) -> Vec<f32> {
    let visualizer = &state.progress.visualizer;
    let sample_rate = state.progress.sample_rate.load(Ordering::Relaxed);
    build_frequency_bands(&visualizer.snapshot(), sample_rate, VISUALIZER_BAND_COUNT)
}
