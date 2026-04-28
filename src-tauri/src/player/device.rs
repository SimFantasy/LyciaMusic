use crate::player::types::{
    AudioCommand, AudioDevice, AudioOutputStatus, PlayerState, SharedProgress, TimedSource,
};
use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub(crate) type StreamData = (OutputStream, OutputStreamHandle, String);

#[tauri::command]
pub fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for device in devices {
        if let Ok(name) = device.name() {
            result.push(AudioDevice {
                id: name.clone(),
                name,
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn set_output_device(
    device_id: Option<String>,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetDevice(device_id))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_current_output_device(
    state: tauri::State<PlayerState>,
) -> Result<AudioOutputStatus, String> {
    let status = state.output_status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

pub(crate) fn default_output_device_name(host: &cpal::Host) -> Option<String> {
    host.default_output_device()?.name().ok()
}

pub(crate) fn create_output_stream(
    host: &cpal::Host,
    device_name: Option<&str>,
) -> Option<StreamData> {
    if let Some(name) = device_name {
        if let Ok(mut devices) = host.output_devices() {
            if let Some(device) = devices.find(|d| d.name().map(|n| n == name).unwrap_or(false)) {
                if let Ok((stream, handle)) = OutputStream::try_from_device(&device) {
                    return Some((stream, handle, name.to_string()));
                }
            }
        }
    }

    let default_device = host.default_output_device()?;
    let active_name = default_device.name().ok()?;
    let (stream, handle) = OutputStream::try_from_device(&default_device).ok()?;
    Some((stream, handle, active_name))
}

pub(crate) fn emit_output_status(
    app: &AppHandle,
    status: &Arc<Mutex<AudioOutputStatus>>,
    selected_device_id: Option<String>,
    active_device_name: Option<String>,
) {
    let next_status = AudioOutputStatus {
        selected_device_id: selected_device_id.clone(),
        active_device_name,
        follows_system_default: selected_device_id.is_none(),
    };

    if let Ok(mut current_status) = status.lock() {
        *current_status = next_status.clone();
    }

    let _ = app.emit("audio-output-device-changed", next_status);
}

pub(crate) fn restore_current_playback(
    stream_data: &Option<StreamData>,
    current_sink: &mut Option<Sink>,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
) {
    if current_path.is_empty() {
        return;
    }

    if let Some((_, handle, _)) = stream_data {
        *current_sink = Sink::try_new(handle).ok();

        let current_samples = progress.samples_played.load(Ordering::Relaxed);
        let rate = progress.sample_rate.load(Ordering::Relaxed);
        let channels = progress.channels.load(Ordering::Relaxed);
        let time_played = if rate > 0 && channels > 0 {
            current_samples as f64 / (rate as u64 * channels as u64) as f64
        } else {
            0.0
        };
        let jump_target = Duration::from_secs_f64(time_played);

        if let Ok(file) = File::open(current_path) {
            let reader = BufReader::with_capacity(512 * 1024, file);
            if let Ok(source) = Decoder::new(reader) {
                let timed_source = TimedSource::new(
                    source.convert_samples::<f32>().skip_duration(jump_target),
                    progress.samples_played.clone(),
                    progress.visualizer.clone(),
                );
                if let Some(sink) = current_sink.as_ref() {
                    sink.set_volume(current_volume);
                    sink.append(timed_source);
                    if is_playing_flag {
                        sink.play();
                    } else {
                        sink.pause();
                    }
                }
            }
        }
    }
}
