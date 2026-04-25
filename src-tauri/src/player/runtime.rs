use crate::player::device::{
    create_output_stream, default_output_device_name, emit_output_status, restore_current_playback,
};
use crate::player::types::{
    AudioCommand, AudioOutputStatus, PlayerState, SeekCompletedPayload, SharedProgress,
    SharedVisualizer, TimedSource,
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
    stream_data: &Option<crate::player::device::StreamData>,
    current_sink: &mut Option<Sink>,
    current_path: &mut String,
    current_volume: f32,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
) {
    *current_path = path;
    *is_playing_flag = true;

    if let Some((_, handle, _)) = stream_data {
        if let Some(sink) = current_sink {
            sink.stop();
        }
        *current_sink = Sink::try_new(handle).ok();

        if let Ok(file) = File::open(current_path.as_str()) {
            let reader = BufReader::with_capacity(512 * 1024, file);
            if let Ok(source) = Decoder::new(reader) {
                let rate = source.sample_rate();
                let channels = source.channels();
                progress.sample_rate.store(rate, Ordering::Relaxed);
                progress.channels.store(channels as u32, Ordering::Relaxed);
                progress.samples_played.store(0, Ordering::Relaxed);
                progress.visualizer.reset();

                let timed_source = TimedSource {
                    inner: source.convert_samples::<f32>(),
                    samples_played: progress.samples_played.clone(),
                    visualizer: progress.visualizer.clone(),
                };

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
    stream_data: &Option<crate::player::device::StreamData>,
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
                    if let Some((_, handle, _)) = stream_data {
                        sink.stop();
                        *current_sink = Sink::try_new(handle).ok();

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

                                let timed_source = TimedSource {
                                    inner: source
                                        .convert_samples::<f32>()
                                        .skip_duration(jump_target),
                                    samples_played: progress.samples_played.clone(),
                                    visualizer: progress.visualizer.clone(),
                                };

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
        let mut stream_data = create_output_stream(&host, None);
        let mut current_sink: Option<Sink> = None;
        let mut current_path = String::new();
        let mut current_volume = 1.0;
        let mut is_playing_flag = false;
        let mut active_device_name = stream_data.as_ref().map(|(_, _, name)| name.clone());

        if let Some((_, handle, _)) = &stream_data {
            current_sink = Sink::try_new(handle).ok();
        }

        emit_output_status(
            &thread_app_handle,
            &thread_output_status,
            selected_device_name.clone(),
            active_device_name.clone(),
        );

        loop {
            match rx.recv_timeout(Duration::from_millis(750)) {
                Ok(cmd) => match cmd {
                    AudioCommand::Play(path) => handle_play(
                        path,
                        &stream_data,
                        &mut current_sink,
                        &mut current_path,
                        current_volume,
                        &mut is_playing_flag,
                        &thread_progress,
                    ),
                    AudioCommand::Pause => {
                        is_playing_flag = false;
                        if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                    }
                    AudioCommand::Resume => {
                        is_playing_flag = true;
                        if let Some(sink) = &current_sink {
                            sink.play();
                        }
                    }
                    AudioCommand::Seek {
                        time,
                        is_playing,
                        request_id,
                    } => handle_seek(
                        time,
                        is_playing,
                        request_id,
                        &stream_data,
                        &mut current_sink,
                        &current_path,
                        current_volume,
                        &mut is_playing_flag,
                        &thread_progress,
                        &thread_app_handle,
                    ),
                    AudioCommand::SetVolume(vol) => {
                        current_volume = vol;
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

                        stream_data = create_output_stream(&host, selected_device_name.as_deref());
                        active_device_name = stream_data.as_ref().map(|(_, _, name)| name.clone());

                        restore_current_playback(
                            &stream_data,
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
                        );
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    if selected_device_name.is_none() {
                        let next_default_name = default_output_device_name(&host);
                        if next_default_name != active_device_name {
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            stream_data = create_output_stream(&host, None);
                            active_device_name =
                                stream_data.as_ref().map(|(_, _, name)| name.clone());

                            restore_current_playback(
                                &stream_data,
                                &mut current_sink,
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
