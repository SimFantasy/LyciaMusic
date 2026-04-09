import type { FolderNode, LibraryFolder, Song } from '../../types';

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioOutputStatus {
  selected_device_id: string | null;
  active_device_name: string | null;
  follows_system_default: boolean;
}

export interface RecentHistoryRecord {
  songPath: string;
  playedAt: number;
}

export interface RecentHistoryImportRecord {
  songPath: string;
  playedAt: number;
}

export interface PlayAudioOptions {
  path: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
}

export interface UpdatePlaybackMetadataOptions {
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  isPlaying: boolean;
}

export interface SeekAudioOptions {
  time: number;
  isPlaying: boolean;
  requestId: number;
}

export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

export interface ForegroundFullscreenState {
  isFullscreen: boolean;
}

export interface TauriCommandMap {
  add_library_folder: { payload: { path: string }; response: void };
  // Deprecated compat command. Do not use in new main-flow code.
  add_sidebar_folder: { payload: { path: string }; response: void };
  remove_library_folder: { payload: { path: string }; response: void };
  // Deprecated compat command. Do not use in new main-flow code.
  remove_sidebar_folder: { payload: { path: string }; response: void };
  get_library_hierarchy: { payload: undefined; response: FolderNode[] };
  get_folder_children: { payload: { folderPath: string }; response: FolderNode[] };
  get_library_folders: { payload: undefined; response: LibraryFolder[] };
  // Deprecated compat command. Main folder-tree flow must use get_library_hierarchy.
  get_sidebar_hierarchy: { payload: undefined; response: FolderNode[] };
  create_folder: { payload: { parentPath: string; folderName: string }; response: string };
  refresh_folder_songs: { payload: { folderPath: string }; response: void };
  delete_folder: { payload: { path: string }; response: void };
  move_file_to_folder: {
    payload: { sourcePath: string; targetFolder: string };
    response: void;
  };
  batch_move_music_files: {
    payload: { paths: string[]; targetFolder: string };
    response: number;
  };
  get_folder_first_song: {
    payload: { folderPath: string };
    response: string | null;
  };
  scan_music_folder: { payload: { folderPath: string }; response: Song[] };
  move_music_file: { payload: { oldPath: string; newPath: string }; response: void };
  show_in_folder: { payload: { path: string }; response: void };
  delete_music_file: { payload: { path: string }; response: void };
  is_directory: { payload: { path: string }; response: boolean };
  parse_audio_files: { payload: { paths: string[] }; response: Song[] };
  set_volume: { payload: { volume: number }; response: void };
  get_playback_progress: { payload: undefined; response: number };
  record_play: { payload: { songPath: string; duration: number }; response: void };
  get_song_cover_thumbnail: { payload: { path: string }; response: string };
  get_song_cover: { payload: { path: string }; response: string };
  play_audio: { payload: PlayAudioOptions; response: void };
  update_playback_metadata: { payload: UpdatePlaybackMetadataOptions; response: void };
  pause_audio: { payload: undefined; response: void };
  resume_audio: { payload: undefined; response: void };
  seek_audio: { payload: SeekAudioOptions; response: void };
  set_output_device: { payload: { deviceId: string | null }; response: void };
  get_output_devices: { payload: undefined; response: AudioDevice[] };
  get_current_output_device: { payload: undefined; response: AudioOutputStatus };
  add_to_history: { payload: { songPath: string }; response: void };
  remove_from_recent_history: { payload: { songPaths: string[] }; response: void };
  clear_recent_history: { payload: undefined; response: void };
  get_recent_history: { payload: { limit: number }; response: RecentHistoryRecord[] };
  import_recent_history: {
    payload: { entries: RecentHistoryImportRecord[] };
    response: void;
  };
  set_mini_boundary_enabled: { payload: { enabled: boolean }; response: void };
  set_dark_mode_for_window: { payload: { dark: boolean }; response: void };
  get_window_material_capabilities: {
    payload: undefined;
    response: WindowMaterialCapabilities;
  };
  get_foreground_fullscreen_state: {
    payload: undefined;
    response: ForegroundFullscreenState;
  };
  refresh_current_window_topmost: {
    payload: { enabled: boolean };
    response: void;
  };
  start_topmost_guard: { payload: undefined; response: void };
  stop_topmost_guard: { payload: undefined; response: void };
  clear_all_app_data: { payload: undefined; response: void };
  open_external_program: {
    payload: { path: string; args: string[] };
    response: void;
  };
  consume_pending_open_paths: { payload: undefined; response: string[] };
}
