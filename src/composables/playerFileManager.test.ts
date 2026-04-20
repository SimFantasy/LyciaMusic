import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerFileManager } from './playerFileManager';

const scanMusicFolderMock = vi.fn();

vi.mock('../services/tauri/fileApi', () => ({
  fileApi: {
    scanMusicFolder: (...args: unknown[]) => scanMusicFolderMock(...args),
    deleteFolder: vi.fn(),
    moveFileToFolder: vi.fn(),
    batchMoveMusicFiles: vi.fn(),
    getFolderFirstSong: vi.fn(),
    moveMusicFile: vi.fn(),
    showInFolder: vi.fn(),
    deleteMusicFile: vi.fn(),
  },
}));

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'C:\\Music\\A\\demo.flac',
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

describe('playerFileManager.refreshFolder', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    scanMusicFolderMock.mockReset();
  });

  it('removes deleted songs from library state and related collections when refreshing a folder', async () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const playbackStore = usePlaybackStore();
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);

    const keptSong = makeSong({
      path: 'C:\\Music\\A\\b.flac',
      name: 'b.flac',
      title: 'B',
    });
    const removedSong = makeSong({
      path: 'C:\\Music\\A\\a.flac',
      name: 'a.flac',
      title: 'A',
    });
    const addedSong = makeSong({
      path: 'C:\\Music\\A\\d.flac',
      name: 'd.flac',
      title: 'D',
    });
    const outsideSong = makeSong({
      path: 'C:\\Music\\Elsewhere\\c.flac',
      name: 'c.flac',
      title: 'C',
    });

    libraryStore.librarySongs = [removedSong, keptSong, outsideSong];
    libraryStore.songList = [removedSong, keptSong, outsideSong];
    collectionsStore.favoritePaths = [removedSong.path, outsideSong.path];
    collectionsStore.playlists = [
      {
        id: 'playlist-1',
        name: 'Playlist',
        songPaths: [removedSong.path, outsideSong.path],
      },
    ];
    collectionsStore.recentSongs = [
      { path: removedSong.path, playedAt: 1 },
      { path: outsideSong.path, playedAt: 2 },
    ];
    playbackStore.playQueue = [removedSong, outsideSong];
    playbackStore.tempQueue = [removedSong];
    playbackStore.currentSong = removedSong;

    scanMusicFolderMock.mockResolvedValue([keptSong, addedSong]);

    const fileManager = createPlayerFileManager({
      removeLibraryFolderLinked: vi.fn(),
      removeFromHistory,
      showToast: vi.fn(),
    });

    const summary = await fileManager.refreshFolder('c:/music/a');

    expect(summary).toEqual({
      removedCount: 1,
      removedPaths: [removedSong.path],
    });
    expect(libraryStore.librarySongs.map(song => song.path)).toEqual([
      outsideSong.path,
      keptSong.path,
      addedSong.path,
    ]);
    expect(libraryStore.songList.map(song => song.path)).toEqual([
      outsideSong.path,
      keptSong.path,
      addedSong.path,
    ]);
    expect(collectionsStore.favoritePaths).toEqual([outsideSong.path]);
    expect(collectionsStore.playlists[0]?.songPaths).toEqual([outsideSong.path]);
    expect(collectionsStore.recentSongs.map(item => item.path)).toEqual([outsideSong.path]);
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([outsideSong.path]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(removeFromHistory).toHaveBeenCalledWith([removedSong.path]);
  });
});
