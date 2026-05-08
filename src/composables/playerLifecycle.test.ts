import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  setVolume: vi.fn().mockResolvedValue(undefined),
  setOutputDevice: vi.fn().mockResolvedValue(undefined),
  setAudioOutputMode: vi.fn().mockResolvedValue(undefined),
  getRemoteSources: vi.fn().mockResolvedValue([]),
  syncRemoteSource: vi.fn().mockResolvedValue(undefined),
  precacheRemoteSong: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    setVolume: mocks.setVolume,
    setOutputDevice: mocks.setOutputDevice,
    setAudioOutputMode: mocks.setAudioOutputMode,
  },
}));

vi.mock('../services/tauri/remoteLibraryApi', () => ({
  remoteLibraryApi: {
    getRemoteSources: mocks.getRemoteSources,
    syncRemoteSource: mocks.syncRemoteSource,
    precacheRemoteSong: mocks.precacheRemoteSong,
  },
}));

vi.mock('./colorExtraction', () => ({
  clearPaletteCache: vi.fn(),
  extractDominantColors: vi.fn().mockResolvedValue([]),
}));

import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerLifecycle } from './playerLifecycle';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'remote://source/demo.mp3',
  name: 'demo.mp3',
  title: 'Demo',
  artist: '未知歌手',
  artist_names: ['未知歌手'],
  effective_artist_names: ['未知歌手'],
  album: '未知专辑',
  album_artist: '未知歌手',
  album_key: '未知专辑::未知歌手',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 0,
  bitrate: 0,
  sample_rate: 0,
  format: 'mp3',
  source_type: 'remote',
  remote_source_id: 'source',
  ...overrides,
});

describe('player lifecycle remote metadata events', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
  });

  it('patches current remote song metadata when the backend finishes caching it', async () => {
    const callbacks = new Map<string, (event: { payload: unknown }) => void>();
    mocks.listen.mockImplementation((eventName: string, callback: (event: { payload: unknown }) => void) => {
      callbacks.set(eventName, callback);
      return Promise.resolve(vi.fn());
    });
    const libraryStore = useLibraryStore();
    const playbackStore = usePlaybackStore();
    const staleSong = makeSong();
    const parsedSong = makeSong({
      title: '一个像夏天一个像秋天',
      artist: '范玮琪',
      artist_names: ['范玮琪'],
      effective_artist_names: ['范玮琪'],
      album: '我们的纪念日',
      album_artist: '范玮琪',
      album_key: '我们的纪念日::范玮琪',
      duration: 249,
      bitrate: 320,
      sample_rate: 44100,
    });
    libraryStore.setSourceSongs([staleSong]);
    playbackStore.currentSong = staleSong;
    const loadLyrics = vi.fn();

    createPlayerLifecycle({
      bootstrapLibrary: vi.fn().mockResolvedValue(undefined),
      togglePlay: vi.fn(),
      nextSong: vi.fn(),
      prevSong: vi.fn(),
      applyLibraryScanBatch: vi.fn(),
      flushBufferedLibraryScanBatch: vi.fn(),
      handleSeekCompleted: vi.fn(),
      schedulePersistedState: vi.fn(),
      flushPersistedState: vi.fn(),
      restorePathBackedState: vi.fn().mockResolvedValue(undefined),
      restoreRecentHistory: vi.fn().mockResolvedValue(undefined),
      refreshStateSongReferences: vi.fn(),
      loadLyrics,
      disposePlayerPlayback: vi.fn(),
      disposeLibraryRuntime: vi.fn(),
      disposePlayerPersistence: vi.fn(),
      disposeLibraryBatch: vi.fn(),
      lastSongPathKey: 'last-song-path',
      legacyLastSongKey: 'last-song',
    }).init();

    callbacks.get('remote-lyrics-cache-ready')?.({
      payload: {
        uri: parsedSong.path,
        song: parsedSong,
      },
    });

    expect(playbackStore.currentSong?.artist).toBe('范玮琪');
    expect(playbackStore.currentSong?.album).toBe('我们的纪念日');
    expect(playbackStore.currentSong?.duration).toBe(249);
    expect(loadLyrics).toHaveBeenCalledTimes(1);
  });
});
