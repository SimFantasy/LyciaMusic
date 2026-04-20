import { tauriInvoke } from './invoke';
import type {
  AudioDevice,
  AudioOutputStatus,
  PlayAudioOptions,
  SeekAudioOptions,
  UpdatePlaybackMetadataOptions,
} from './contracts';

export const playbackApi = {
  setVolume: (volume: number): Promise<void> => tauriInvoke('set_volume', { volume }),
  getPlaybackProgress: (): Promise<number> => tauriInvoke('get_playback_progress'),
  recordPlay: (payload: {
    songPath: string;
    listenedMs: number;
    durationMs: number;
    title: string;
    artist: string;
    album: string;
    trackNumber?: string;
  }) =>
    tauriInvoke('record_play', { payload }),
  playAudio: (options: PlayAudioOptions): Promise<void> => tauriInvoke('play_audio', options),
  updatePlaybackMetadata: (options: UpdatePlaybackMetadataOptions): Promise<void> =>
    tauriInvoke('update_playback_metadata', options),
  pauseAudio: (): Promise<void> => tauriInvoke('pause_audio'),
  resumeAudio: (): Promise<void> => tauriInvoke('resume_audio'),
  seekAudio: (options: SeekAudioOptions): Promise<void> => tauriInvoke('seek_audio', options),
  setOutputDevice: (deviceId: string | null) =>
    tauriInvoke('set_output_device', { deviceId }),
  getOutputDevices: (): Promise<AudioDevice[]> => tauriInvoke('get_output_devices'),
  getCurrentOutputDevice: (): Promise<AudioOutputStatus> =>
    tauriInvoke('get_current_output_device'),
};
