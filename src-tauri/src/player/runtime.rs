use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::output::shared::progress_seconds_from_samples;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::{ExclusivePlayRequest, WasapiExclusivePlayback};
use crate::player::output::OutputBackend;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioOutputStatus, PlayerState, SeekCompletedPayload,
    SharedProgress, SharedVisualizer, TimedSource,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rodio::{Decoder, Sink, Source};
use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PLAYER_POLL_INTERVAL: Duration = Duration::from_millis(150);

fn progress_duration(progress: &Arc<SharedProgress>) -> Duration {
    let current_samples = progress.samples_played.load(Ordering::Relaxed);
    let rate = progress.sample_rate.load(Ordering::Relaxed);
    let channels = progress.channels.load(Ordering::Relaxed);

    Duration::from_secs_f64(progress_seconds_from_samples(
        current_samples,
        rate,
        channels,
    ))
}

#[cfg(target_os = "windows")]
fn stop_exclusive_playback(exclusive_playback: &mut Option<WasapiExclusivePlayback>) {
    if let Some(mut playback) = exclusive_playback.take() {
        playback.stop();
    }
}

#[cfg(target_os = "windows")]
fn start_exclusive_playback(
    path: String,
    selected_device_name: Option<String>,
    current_volume: f32,
    is_playing: bool,
    start_time: Duration,
    progress: &Arc<SharedProgress>,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path,
        device_name: selected_device_name,
        volume: current_volume,
        is_playing,
        progress: progress.clone(),
        start_time,
    })
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
fn restore_preferred_output(
    selected_device_name: &Option<String>,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    #[cfg(target_os = "windows")] exclusive_playback: &mut Option<WasapiExclusivePlayback>,
    active_device_name: &mut Option<String>,
    active_output_mode: &mut AudioOutputMode,
    fallback_reason: &mut Option<String>,
    requested_output_mode: AudioOutputMode,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
) {
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());

    #[cfg(target_os = "windows")]
    if requested_output_mode == AudioOutputMode::WasapiExclusive && !current_path.is_empty() {
        match start_exclusive_playback(
            current_path.to_string(),
            selected_device_name.clone(),
            current_volume,
            is_playing_flag,
            progress_duration(progress),
            progress,
        ) {
            Ok(playback) => {
                *active_device_name = Some(playback.active_device_name().to_string());
                *active_output_mode = AudioOutputMode::WasapiExclusive;
                *fallback_reason = None;
                *exclusive_playback = Some(playback);
                return;
            }
            Err(error) => {
                *active_output_mode = AudioOutputMode::Shared;
                *fallback_reason = Some(error);
            }
        }
    } else {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = if requested_output_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    restore_current_playback(
        output,
        current_sink,
        current_path,
        current_volume,
        is_playing_flag,
        progress,
    );
}

fn initialize_media_controls(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let controls = Arc::new(Mutex::new(None));

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(handle) = window.window_handle() {
            let raw_handle = handle.as_raw();

            #[cfg(target_os = "windows")]
            {
                if let RawWindowHandle::Win32(h) = raw_handle {
                    let hwnd = h.hwnd.get() as *mut std::ffi::c_void;

                    let config = PlatformConfig {
                        dbus_name: "my_cloud_music",
                        display_name: "My Cloud Music",
                        hwnd: Some(hwnd),
                    };

                    match MediaControls::new(config) {
                        Ok(mut mc) => {
                            let app_clone = app.clone();
                            let _ = mc.attach(move |event| match event {
                                MediaControlEvent::Play => {
                                    let _ = app_clone.emit("player:play", ());
                                }
                                MediaControlEvent::Pause => {
                                    let _ = app_clone.emit("player:pause", ());
                                }
                                MediaControlEvent::Next => {
                                    let _ = app_clone.emit("player:next", ());
                                }
                                MediaControlEvent::Previous => {
                                    let _ = app_clone.emit("player:prev", ());
                                }
                                _ => {}
                            });
                            *controls.lock().unwrap() = Some(mc);
                        }
                        Err(error) => println!("Error initializing MediaControls: {:?}", error),
                    }
                }
            }
        }
    }

    controls
}

fn handle_play(
    path: String,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &mut String,
    current_volume: f32,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
) {
    *current_path = path;
    *is_playing_flag = true;

    if let Some(output) = output {
        if let Some(sink) = current_sink {
            sink.stop();
        }
        *current_sink = output.create_sink().ok();

        if let Ok(file) = File::open(current_path.as_str()) {
            let reader = BufReader::with_capacity(512 * 1024, file);
            if let Ok(source) = Decoder::new(reader) {
                let rate = source.sample_rate();
                let channels = source.channels();
                progress.sample_rate.store(rate, Ordering::Relaxed);
                progress.channels.store(channels as u32, Ordering::Relaxed);
                progress.samples_played.store(0, Ordering::Relaxed);
                progress.visualizer.reset();

                let timed_source = TimedSource::new(
                    source.convert_samples::<f32>(),
                    progress.samples_played.clone(),
                    progress.visualizer.clone(),
                );

                if let Some(sink) = current_sink {
                    sink.append(timed_source);
                    sink.set_volume(current_volume);
                    sink.play();
                }
            }
        }
    }
}

fn handle_seek(
    time: f64,
    is_playing: bool,
    request_id: u64,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    app: &AppHandle,
) {
    let clamped_time = time.max(0.0);
    let jump_target = Duration::from_secs_f64(clamped_time);
    *is_playing_flag = is_playing;
    progress.visualizer.reset();

    if let Some(sink) = current_sink {
        match sink.try_seek(jump_target) {
            Ok(()) => {
                let rate = progress.sample_rate.load(Ordering::Relaxed);
                let channels = progress.channels.load(Ordering::Relaxed);
                let samples_at_target =
                    (clamped_time * rate as f64 * channels as f64).round() as u64;
                progress
                    .samples_played
                    .store(samples_at_target, Ordering::Relaxed);

                if is_playing {
                    sink.play();
                } else {
                    sink.pause();
                }
            }
            Err(_) => {
                if !current_path.is_empty() {
                    if let Some(output) = output {
                        sink.stop();
                        *current_sink = output.create_sink().ok();

                        if let Ok(file) = File::open(current_path) {
                            let reader = BufReader::with_capacity(512 * 1024, file);
                            if let Ok(source) = Decoder::new(reader) {
                                let rate = source.sample_rate();
                                let channels = source.channels();
                                let samples_to_skip =
                                    (clamped_time * rate as f64 * channels as f64).round() as u64;
                                progress
                                    .samples_played
                                    .store(samples_to_skip, Ordering::Relaxed);

                                let timed_source = TimedSource::new(
                                    source.convert_samples::<f32>().skip_duration(jump_target),
                                    progress.samples_played.clone(),
                                    progress.visualizer.clone(),
                                );

                                if let Some(new_sink) = current_sink {
                                    new_sink.set_volume(current_volume);
                                    new_sink.append(timed_source);
                                    if is_playing {
                                        new_sink.play();
                                    } else {
                                        new_sink.pause();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id,
            time: clamped_time,
        },
    );
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (tx, rx) = channel::<AudioCommand>();
    let shared_progress = Arc::new(SharedProgress {
        samples_played: Arc::new(AtomicU64::new(0)),
        sample_rate: Arc::new(AtomicU32::new(44100)),
        channels: Arc::new(AtomicU32::new(2)),
        visualizer: Arc::new(SharedVisualizer::new()),
    });
    let thread_progress = shared_progress.clone();
    let thread_app_handle = app.clone();
    let controls = initialize_media_controls(app);
    let output_status = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let thread_output_status = output_status.clone();

    thread::spawn(move || {
        let host = cpal::default_host();
        let mut selected_device_name: Option<String> = None;
        let mut output = SharedOutputBackend::open(&host, None).ok();
        let mut current_sink: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_playback: Option<WasapiExclusivePlayback> = None;
        let mut current_path = String::new();
        let mut current_volume = 1.0;
        let mut is_playing_flag = false;
        let mut requested_output_mode = AudioOutputMode::Shared;
        let mut active_output_mode = AudioOutputMode::Shared;
        let mut fallback_reason: Option<String> = None;
        let mut active_device_name = output
            .as_ref()
            .map(|output| output.active_device_name().to_string());

        if let Some(output) = &output {
            current_sink = output.create_sink().ok();
        }

        emit_output_status(
            &thread_app_handle,
            &thread_output_status,
            selected_device_name.clone(),
            active_device_name.clone(),
            requested_output_mode,
            active_output_mode,
            fallback_reason.clone(),
        );

        loop {
            match rx.recv_timeout(PLAYER_POLL_INTERVAL) {
                Ok(cmd) => match cmd {
                    AudioCommand::Play { path, output_mode } => {
                        requested_output_mode = output_mode;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive {
                            match start_exclusive_playback(
                                path.clone(),
                                selected_device_name.clone(),
                                current_volume,
                                true,
                                Duration::ZERO,
                                &thread_progress,
                            ) {
                                Ok(playback) => {
                                    active_device_name =
                                        Some(playback.active_device_name().to_string());
                                    active_output_mode = AudioOutputMode::WasapiExclusive;
                                    fallback_reason = None;
                                    current_path = path;
                                    is_playing_flag = true;
                                    exclusive_playback = Some(playback);

                                    emit_output_status(
                                        &thread_app_handle,
                                        &thread_output_status,
                                        selected_device_name.clone(),
                                        active_device_name.clone(),
                                        requested_output_mode,
                                        active_output_mode,
                                        fallback_reason.clone(),
                                    );
                                    continue;
                                }
                                Err(error) => {
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason = Some(error);
                                }
                            }
                        }

                        #[cfg(not(target_os = "windows"))]
                        if output_mode == AudioOutputMode::WasapiExclusive {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(
                                "WASAPI exclusive mode is only available on Windows".to_string(),
                            );
                        }

                        if active_output_mode == AudioOutputMode::Shared {
                            active_device_name = output
                                .as_ref()
                                .map(|output| output.active_device_name().to_string());
                        }

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );

                        handle_play(
                            path,
                            &output,
                            &mut current_sink,
                            &mut current_path,
                            current_volume,
                            &mut is_playing_flag,
                            &thread_progress,
                        )
                    }
                    AudioCommand::Pause => {
                        is_playing_flag = false;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.pause();
                        } else if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                    }
                    AudioCommand::Resume => {
                        is_playing_flag = true;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.resume();
                        } else if let Some(sink) = &current_sink {
                            sink.play();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.play();
                        }
                    }
                    AudioCommand::Seek {
                        time,
                        is_playing,
                        request_id,
                    } => {
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            let clamped_time = time.max(0.0);
                            is_playing_flag = is_playing;
                            playback.seek(Duration::from_secs_f64(clamped_time), is_playing);
                            let _ = thread_app_handle.emit(
                                "seek_completed",
                                SeekCompletedPayload {
                                    request_id,
                                    time: clamped_time,
                                },
                            );
                            continue;
                        }

                        handle_seek(
                            time,
                            is_playing,
                            request_id,
                            &output,
                            &mut current_sink,
                            &current_path,
                            current_volume,
                            &mut is_playing_flag,
                            &thread_progress,
                            &thread_app_handle,
                        )
                    }
                    AudioCommand::SetVolume(vol) => {
                        current_volume = vol;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.set_volume(vol);
                        } else if let Some(sink) = &current_sink {
                            sink.set_volume(vol);
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.set_volume(vol);
                        }
                    }
                    AudioCommand::SetDevice(device_name) => {
                        selected_device_name = device_name;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        output =
                            SharedOutputBackend::open(&host, selected_device_name.as_deref()).ok();
                        restore_preferred_output(
                            &selected_device_name,
                            &output,
                            &mut current_sink,
                            #[cfg(target_os = "windows")]
                            &mut exclusive_playback,
                            &mut active_device_name,
                            &mut active_output_mode,
                            &mut fallback_reason,
                            requested_output_mode,
                            &current_path,
                            current_volume,
                            is_playing_flag,
                            &thread_progress,
                        );

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );
                    }
                    AudioCommand::SetOutputMode(output_mode) => {
                        requested_output_mode = output_mode;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        restore_preferred_output(
                            &selected_device_name,
                            &output,
                            &mut current_sink,
                            #[cfg(target_os = "windows")]
                            &mut exclusive_playback,
                            &mut active_device_name,
                            &mut active_output_mode,
                            &mut fallback_reason,
                            requested_output_mode,
                            &current_path,
                            current_volume,
                            is_playing_flag,
                            &thread_progress,
                        );

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    #[cfg(target_os = "windows")]
                    if let Some(result) = exclusive_playback
                        .as_ref()
                        .and_then(|playback| playback.try_finished())
                    {
                        stop_exclusive_playback(&mut exclusive_playback);

                        if let Err(error) = result {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(error);
                            active_device_name = output
                                .as_ref()
                                .map(|output| output.active_device_name().to_string());
                            restore_current_playback(
                                &output,
                                &mut current_sink,
                                &current_path,
                                current_volume,
                                is_playing_flag,
                                &thread_progress,
                            );

                            emit_output_status(
                                &thread_app_handle,
                                &thread_output_status,
                                selected_device_name.clone(),
                                active_device_name.clone(),
                                requested_output_mode,
                                active_output_mode,
                                fallback_reason.clone(),
                            );
                        }
                    }

                    if selected_device_name.is_none() {
                        let next_default_name = default_output_device_name(&host);
                        if next_default_name != active_device_name {
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            #[cfg(target_os = "windows")]
                            stop_exclusive_playback(&mut exclusive_playback);
                            output = SharedOutputBackend::open(&host, None).ok();
                            restore_preferred_output(
                                &selected_device_name,
                                &output,
                                &mut current_sink,
                                #[cfg(target_os = "windows")]
                                &mut exclusive_playback,
                                &mut active_device_name,
                                &mut active_output_mode,
                                &mut fallback_reason,
                                requested_output_mode,
                                &current_path,
                                current_volume,
                                is_playing_flag,
                                &thread_progress,
                            );

                            emit_output_status(
                                &thread_app_handle,
                                &thread_output_status,
                                None,
                                active_device_name.clone(),
                                requested_output_mode,
                                active_output_mode,
                                fallback_reason.clone(),
                            );
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    PlayerState {
        tx: Mutex::new(tx),
        progress: shared_progress,
        controls,
        output_status,
    }
}
