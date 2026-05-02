use crate::player::output::OutputError;
use crate::player::types::{SharedProgress, SharedVisualizer};
use rodio::{Decoder, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{channel, sync_channel, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use wasapi::{
    deinitialize, initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

const EXCLUSIVE_PERIOD_HNS: i64 = 200_000;
const EXCLUSIVE_BUFFER_MULTIPLIER: i64 = 4;

pub(crate) struct WasapiExclusivePlayback {
    tx: Sender<ExclusiveCommand>,
    result_rx: Receiver<Result<(), String>>,
    join_handle: Option<JoinHandle<()>>,
    active_device_name: String,
}

pub(crate) struct ExclusivePlayRequest {
    pub path: String,
    pub device_name: Option<String>,
    pub volume: f32,
    pub is_playing: bool,
    pub progress: Arc<SharedProgress>,
    pub start_time: Duration,
}

enum ExclusiveCommand {
    Pause,
    Resume,
    Seek { time: Duration, is_playing: bool },
    Stop,
    SetVolume(f32),
}

impl WasapiExclusivePlayback {
    pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
        let (command_tx, command_rx) = channel::<ExclusiveCommand>();
        let (init_tx, init_rx) = sync_channel::<Result<String, String>>(1);
        let (result_tx, result_rx) = channel::<Result<(), String>>();

        let join_handle = thread::spawn(move || {
            let result = run_exclusive_playback(request, command_rx, init_tx);
            if let Err(error) = &result {
                eprintln!("WASAPI exclusive playback failed: {error}");
            }
            let _ = result_tx.send(result);
            deinitialize();
        });

        match init_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(active_device_name)) => Ok(Self {
                tx: command_tx,
                result_rx,
                join_handle: Some(join_handle),
                active_device_name,
            }),
            Ok(Err(error)) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(error))
            }
            Err(error) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(format!(
                    "WASAPI exclusive initialization timed out: {error}"
                )))
            }
        }
    }

    pub(crate) fn active_device_name(&self) -> &str {
        &self.active_device_name
    }

    pub(crate) fn pause(&self) {
        let _ = self.tx.send(ExclusiveCommand::Pause);
    }

    pub(crate) fn resume(&self) {
        let _ = self.tx.send(ExclusiveCommand::Resume);
    }

    pub(crate) fn seek(&self, time: Duration, is_playing: bool) {
        let _ = self.tx.send(ExclusiveCommand::Seek { time, is_playing });
    }

    pub(crate) fn set_volume(&self, volume: f32) {
        let _ = self.tx.send(ExclusiveCommand::SetVolume(volume));
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.tx.send(ExclusiveCommand::Stop);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }

    pub(crate) fn try_finished(&self) -> Option<Result<(), String>> {
        match self.result_rx.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(
                "WASAPI exclusive playback thread disconnected".to_string(),
            )),
        }
    }
}

impl Drop for WasapiExclusivePlayback {
    fn drop(&mut self) {
        self.stop();
    }
}

struct ExclusiveSource {
    source: Box<dyn Source<Item = f32> + Send>,
    progress: Arc<SharedProgress>,
    visualizer: Arc<SharedVisualizer>,
    channels: u16,
    channel_sum: f32,
    channel_samples: u16,
}

impl ExclusiveSource {
    fn open(
        path: &str,
        start_time: Duration,
        progress: Arc<SharedProgress>,
    ) -> Result<(Self, u32, u16), String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let reader = BufReader::with_capacity(512 * 1024, file);
        let decoder = Decoder::new(reader).map_err(|error| error.to_string())?;
        let sample_rate = decoder.sample_rate();
        let channels = decoder.channels();
        let samples_at_target =
            (start_time.as_secs_f64() * sample_rate as f64 * channels as f64).round() as u64;

        progress.sample_rate.store(sample_rate, Ordering::Relaxed);
        progress.channels.store(channels as u32, Ordering::Relaxed);
        progress
            .samples_played
            .store(samples_at_target, Ordering::Relaxed);
        progress.visualizer.reset();

        Ok((
            Self {
                source: Box::new(decoder.convert_samples::<f32>().skip_duration(start_time)),
                visualizer: progress.visualizer.clone(),
                progress,
                channels,
                channel_sum: 0.0,
                channel_samples: 0,
            },
            sample_rate,
            channels,
        ))
    }

    fn read_frames(&mut self, frame_count: usize, volume: f32) -> (Vec<u8>, bool) {
        let sample_count = frame_count.saturating_mul(self.channels as usize);
        let mut bytes = Vec::with_capacity(sample_count * std::mem::size_of::<f32>());
        let mut ended = false;

        for _ in 0..sample_count {
            let sample = match self.source.next() {
                Some(sample) => {
                    self.progress.samples_played.fetch_add(1, Ordering::Relaxed);
                    self.channel_sum += sample;
                    self.channel_samples += 1;

                    if self.channel_samples >= self.channels {
                        self.visualizer
                            .push_sample(self.channel_sum / self.channel_samples as f32);
                        self.channel_sum = 0.0;
                        self.channel_samples = 0;
                    }

                    sample
                }
                None => {
                    ended = true;
                    0.0
                }
            };

            bytes.extend_from_slice(&(sample * volume).clamp(-1.0, 1.0).to_le_bytes());
        }

        (bytes, ended)
    }
}

fn run_exclusive_playback(
    request: ExclusivePlayRequest,
    command_rx: Receiver<ExclusiveCommand>,
    init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;

    let (mut source, sample_rate, channels) =
        ExclusiveSource::open(&request.path, request.start_time, request.progress.clone())?;

    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = if let Some(name) = request.device_name.as_deref() {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|error| error.to_string())?;
        collection
            .get_device_with_name(name)
            .map_err(|error| error.to_string())?
    } else {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| error.to_string())?
    };
    let active_device_name = device
        .get_friendlyname()
        .map_err(|error| error.to_string())?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let requested_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        sample_rate as usize,
        channels as usize,
        None,
    );
    let exclusive_format = audio_client
        .is_supported_exclusive_with_quirks(&requested_format)
        .map_err(|error| error.to_string())?;
    let period_hns = audio_client
        .calculate_aligned_period_near(EXCLUSIVE_PERIOD_HNS, None, &exclusive_format)
        .unwrap_or(EXCLUSIVE_PERIOD_HNS);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: period_hns * EXCLUSIVE_BUFFER_MULTIPLIER,
        period_hns,
    };

    audio_client
        .initialize_client(&exclusive_format, &Direction::Render, &mode)
        .map_err(|error| error.to_string())?;
    let render_client = audio_client
        .get_audiorenderclient()
        .map_err(|error| error.to_string())?;
    let buffer_size = audio_client
        .get_buffer_size()
        .map_err(|error| error.to_string())? as usize;

    let volume = request.volume.clamp(0.0, 1.0);
    let (prefill, _) = source.read_frames(buffer_size, volume);
    render_client
        .write_to_device(buffer_size, &prefill, None)
        .map_err(|error| error.to_string())?;

    if request.is_playing {
        audio_client
            .start_stream()
            .map_err(|error| error.to_string())?;
    }

    let _ = init_tx.send(Ok(active_device_name));

    let mut is_playing = request.is_playing;
    let mut volume = volume;

    loop {
        while let Ok(command) = command_rx.try_recv() {
            match command {
                ExclusiveCommand::Pause => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    is_playing = false;
                }
                ExclusiveCommand::Resume => {
                    if !is_playing {
                        audio_client
                            .start_stream()
                            .map_err(|error| error.to_string())?;
                    }
                    is_playing = true;
                }
                ExclusiveCommand::Seek {
                    time,
                    is_playing: next_playing,
                } => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    audio_client
                        .reset_stream()
                        .map_err(|error| error.to_string())?;
                    source =
                        ExclusiveSource::open(&request.path, time, request.progress.clone())?.0;
                    let (prefill, _) = source.read_frames(buffer_size, volume);
                    render_client
                        .write_to_device(buffer_size, &prefill, None)
                        .map_err(|error| error.to_string())?;
                    if next_playing {
                        audio_client
                            .start_stream()
                            .map_err(|error| error.to_string())?;
                    }
                    is_playing = next_playing;
                }
                ExclusiveCommand::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(());
                }
                ExclusiveCommand::SetVolume(next_volume) => {
                    volume = next_volume.clamp(0.0, 1.0);
                }
            }
        }

        if !is_playing {
            thread::sleep(Duration::from_millis(20));
            continue;
        }

        let available_frames = audio_client
            .get_available_space_in_frames()
            .map_err(|error| error.to_string())? as usize;
        if available_frames == 0 {
            thread::sleep(Duration::from_millis(5));
            continue;
        }

        let (bytes, ended) = source.read_frames(available_frames, volume);
        render_client
            .write_to_device(available_frames, &bytes, None)
            .map_err(|error| error.to_string())?;

        if ended {
            let _ = audio_client.stop_stream();
            return Ok(());
        }
    }
}
