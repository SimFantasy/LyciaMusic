import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../../types';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryAllSongPathCache } from '../../composables/useLibraryAllSongPathCache';
import { usePlayerLibraryView } from './usePlayerLibraryView';

const tauriInvokeMock = vi.fn();

vi.mock('../../services/tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

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
  added_at: 1,
  ...overrides,
});

describe('player library view first import refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());

    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command !== 'get_library_song_paths_for_all_view') {
        return [];
      }

      const libraryStore = useLibraryStore();
      return [...libraryStore.canonicalSongPaths];
    });
  });

  it('refreshes local music after songs are imported into an empty library', async () => {
    const navigationStore = useNavigationStore();
    const libraryStore = useLibraryStore();

    navigationStore.currentViewMode = 'all';
    libraryStore.localSortMode = 'title';

    const { displaySongList } = usePlayerLibraryView();
    await flushPromises();

    expect(displaySongList.value).toEqual([]);

    const importedSong = makeSong();
    useLibraryAllSongPathCache().clearLibraryAllSongPathCache();
    libraryStore.librarySongs = [importedSong];
    await vi.waitFor(() => {
      expect(displaySongList.value.map(song => song.path)).toEqual([importedSong.path]);
    });
  });
});
