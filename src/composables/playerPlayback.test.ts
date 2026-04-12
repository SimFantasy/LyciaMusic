import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    playAudio: vi.fn().mockResolvedValue(undefined),
    updatePlaybackMetadata: vi.fn().mockResolvedValue(undefined),
    getPlaybackProgress: vi.fn().mockResolvedValue(0),
    pauseAudio: vi.fn().mockResolvedValue(undefined),
    resumeAudio: vi.fn().mockResolvedValue(undefined),
    seekAudio: vi.fn().mockResolvedValue(undefined),
    recordPlay: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./useCoverCache', () => ({
  useCoverCache: () => ({
    loadCover: vi.fn().mockResolvedValue(''),
    loadCoverPath: vi.fn().mockResolvedValue(''),
    loadFullCover: vi.fn().mockResolvedValue(''),
    peekCoverUrl: vi.fn().mockReturnValue(''),
    peekCoverPath: vi.fn().mockReturnValue(''),
    getFullCoverUrl: vi.fn().mockReturnValue(''),
  }),
}));

import type { Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerPlayback } from './playerPlayback';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('player playback domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('rebuilds the queue from the display song list order when playback starts', async () => {
    const playbackStore = usePlaybackStore();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    const displaySongList = [firstSong, secondSong];
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => displaySongList,
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(firstSong);

    expect(playbackStore.playQueue.map(song => song.path)).toEqual(displaySongList.map(song => song.path));
    playerPlayback.dispose();
  });

  it('inserts a searched song directly after the previously playing song', async () => {
    const playbackStore = usePlaybackStore();
    const songA = makeSong({ path: '/music/a.flac', title: 'A' });
    const songB = makeSong({ path: '/music/b.flac', title: 'B' });
    const songC = makeSong({ path: '/music/c.flac', title: 'C' });
    const songD = makeSong({ path: '/music/d.flac', title: 'D' });
    const searchedSong = makeSong({ path: '/music/search.flac', title: 'Search' });
    playbackStore.currentSong = songA;
    playbackStore.playQueue = [songA, songB, songC, songD];

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [searchedSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(searchedSong, { insertAfterCurrent: true });

    expect(playbackStore.currentSong?.path).toBe(searchedSong.path);
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([
      songA.path,
      searchedSong.path,
      songB.path,
      songC.path,
      songD.path,
    ]);
    playerPlayback.dispose();
  });
});
