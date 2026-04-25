use rodio::source::SeekError;
use rodio::Source;
use serde::Serialize;
use souvlaki::MediaControls;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const VISUALIZER_BAND_COUNT: usize = 48;
const VISUALIZER_SAMPLES_PER_BAND: u32 = 1024;

pub struct SharedVisualizer {
    pub levels: Vec<AtomicU32>,
    pub cursor: AtomicU64,
    bucket_samples: AtomicU32,
    bucket_peak: AtomicU32,
}

impl SharedVisualizer {
    pub fn new() -> Self {
        Self {
            levels: (0..VISUALIZER_BAND_COUNT)
                .map(|_| AtomicU32::new(0))
                .collect(),
            cursor: AtomicU64::new(0),
            bucket_samples: AtomicU32::new(0),
            bucket_peak: AtomicU32::new(0),
        }
    }

    pub fn reset(&self) {
        for level in &self.levels {
            level.store(0, Ordering::Relaxed);
        }
        self.cursor.store(0, Ordering::Relaxed);
        self.bucket_samples.store(0, Ordering::Relaxed);
        self.bucket_peak.store(0, Ordering::Relaxed);
    }

    pub fn push_sample(&self, sample: f32) {
        let scaled = (sample.abs().min(1.0) * 1000.0).round() as u32;
        let mut current_peak = self.bucket_peak.load(Ordering::Relaxed);

        while scaled > current_peak {
            match self.bucket_peak.compare_exchange_weak(
                current_peak,
                scaled,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next_peak) => current_peak = next_peak,
            }
        }

        let count = self.bucket_samples.fetch_add(1, Ordering::Relaxed) + 1;
        if count >= VISUALIZER_SAMPLES_PER_BAND {
            let peak = self.bucket_peak.swap(0, Ordering::Relaxed);
            self.bucket_samples.store(0, Ordering::Relaxed);
            let cursor = self.cursor.fetch_add(1, Ordering::Relaxed) as usize;
            self.levels[cursor % VISUALIZER_BAND_COUNT].store(peak, Ordering::Relaxed);
        }
    }
}

pub struct TimedSource<S> {
    pub inner: S,
    pub samples_played: Arc<AtomicU64>,
    pub visualizer: Arc<SharedVisualizer>,
}

impl<S> Iterator for TimedSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next();
        if let Some(value) = sample {
            self.samples_played.fetch_add(1, Ordering::Relaxed);
            self.visualizer.push_sample(value);
        }
        sample
    }
}

impl<S> Source for TimedSource<S>
where
    S: Source<Item = f32>,
{
    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)
    }
}

pub struct SharedProgress {
    pub samples_played: Arc<AtomicU64>,
    pub sample_rate: Arc<AtomicU32>,
    pub channels: Arc<AtomicU32>,
    pub visualizer: Arc<SharedVisualizer>,
}

pub enum AudioCommand {
    Play(String),
    Pause,
    Resume,
    Seek {
        time: f64,
        is_playing: bool,
        request_id: u64,
    },
    SetVolume(f32),
    SetDevice(Option<String>),
}

pub struct PlayerState {
    pub tx: Mutex<Sender<AudioCommand>>,
    pub progress: Arc<SharedProgress>,
    pub controls: Arc<Mutex<Option<MediaControls>>>,
    pub output_status: Arc<Mutex<AudioOutputStatus>>,
}

#[derive(Serialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Default)]
pub struct AudioOutputStatus {
    pub selected_device_id: Option<String>,
    pub active_device_name: Option<String>,
    pub follows_system_default: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct SeekCompletedPayload {
    pub request_id: u64,
    pub time: f64,
}
