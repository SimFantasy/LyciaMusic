use rodio::source::SeekError;
use rodio::Source;
use serde::Serialize;
use souvlaki::MediaControls;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct TimedSource<S> {
    pub inner: S,
    pub samples_played: Arc<AtomicU64>,
}

impl<S> Iterator for TimedSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next();
        if sample.is_some() {
            self.samples_played.fetch_add(1, Ordering::Relaxed);
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
