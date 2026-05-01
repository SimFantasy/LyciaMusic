use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{AudioCommand, PlayerState, VISUALIZER_BAND_COUNT};
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use std::sync::atomic::Ordering;
use std::time::Duration;

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
pub fn play_audio(
    path: String,
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let normalized_cover = normalize_cover_for_smtc(&cover);
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Play(path))
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
