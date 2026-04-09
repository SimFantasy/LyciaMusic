import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';

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

describe('player library view', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    libraryStore.artistSortMode = 'count';
    libraryStore.albumSortMode = 'artist';
    libraryStore.artistCustomOrder = [];
    libraryStore.albumCustomOrder = [];
    libraryStore.folderSortMode = 'title';
    libraryStore.folderCustomOrder = {};
    libraryStore.localSortMode = 'title';
    libraryStore.localCustomOrder = [];
    collectionsStore.playlistSortMode = 'custom';
  });

  it('filters folder songs to direct children and keeps custom folder order', () => {
    const libraryStore = useLibraryStore();
    const navigationStore = useNavigationStore();
    const firstSong = makeSong({ path: '/music/root/alpha.flac', title: 'Alpha', artist: 'A' });
    const secondSong = makeSong({ path: '/music/root/beta.flac', title: 'Beta', artist: 'B' });
    const nestedSong = makeSong({ path: '/music/root/live/gamma.flac', title: 'Gamma', artist: 'C' });

    libraryStore.songList = [firstSong, secondSong, nestedSong];
    navigationStore.currentViewMode = 'folder';
    navigationStore.currentFolderFilter = '/music/root';
    libraryStore.folderSortMode = 'custom';
    libraryStore.folderCustomOrder = {
      '/music/root': [secondSong.path, firstSong.path],
    };

    const { displaySongList } = usePlayerLibraryView();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      secondSong.path,
      firstSong.path,
    ]);
  });

  it('applies favorites detail filters and local sorting rules', () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const navigationStore = useNavigationStore();
    const zebra = makeSong({
      path: '/music/zebra.flac',
      title: 'Zebra',
      name: 'zebra.flac',
      artist: 'Target Artist',
      artist_names: ['Target Artist'],
      effective_artist_names: ['Target Artist'],
      added_at: 2,
    });
    const alpha = makeSong({
      path: '/music/alpha.flac',
      title: 'Alpha',
      name: 'alpha.flac',
      artist: 'Target Artist',
      artist_names: ['Target Artist'],
      effective_artist_names: ['Target Artist'],
      added_at: 3,
    });
    const outsider = makeSong({
      path: '/music/other.flac',
      title: 'Other',
      artist: 'Other Artist',
      artist_names: ['Other Artist'],
      effective_artist_names: ['Other Artist'],
      added_at: 1,
    });

    libraryStore.librarySongs = [zebra, alpha, outsider];
    collectionsStore.favoritePaths = [zebra.path, alpha.path, outsider.path];
    navigationStore.currentViewMode = 'favorites';
    navigationStore.favTab = 'artists';
    navigationStore.favDetailFilter = { type: 'artist', name: 'Target Artist' };
    libraryStore.localSortMode = 'title';

    const { displaySongList, favArtistList } = usePlayerLibraryView();

    expect(displaySongList.value.map(song => song.title)).toEqual(['Alpha', 'Zebra']);
    expect(favArtistList.value.map(item => item.name)).toContain('Target Artist');
    expect(favArtistList.value.find(item => item.name === 'Target Artist')?.count).toBe(2);
  });

  it('resolves recent songs from path-backed history entries', () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const navigationStore = useNavigationStore();
    const alpha = makeSong({ path: '/music/alpha.flac', title: 'Alpha', added_at: 3 });
    const beta = makeSong({ path: '/music/beta.flac', title: 'Beta', added_at: 2 });

    libraryStore.librarySongs = [alpha, beta];
    collectionsStore.recentSongs = [
      { path: beta.path, playedAt: 2 },
      { path: '/music/missing.flac', playedAt: 3 },
      { path: alpha.path, playedAt: 1 },
    ];
    navigationStore.currentViewMode = 'recent';
    libraryStore.localSortMode = 'title';

    const { displaySongList } = usePlayerLibraryView();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      alpha.path,
      beta.path,
    ]);
  });

  it('sorts local music by file modified time in both directions', () => {
    const libraryStore = useLibraryStore();
    const navigationStore = useNavigationStore();
    const oldSong = makeSong({
      path: '/music/old.flac',
      title: 'Old',
      file_modified_at: 10,
    });
    const newSong = makeSong({
      path: '/music/new.flac',
      title: 'New',
      file_modified_at: 20,
    });

    libraryStore.librarySongs = [oldSong, newSong];
    navigationStore.currentViewMode = 'all';
    libraryStore.localSortMode = 'file_modified_at';

    const { displaySongList } = usePlayerLibraryView();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      newSong.path,
      oldSong.path,
    ]);

    libraryStore.localSortMode = 'file_modified_at_asc';

    expect(displaySongList.value.map(song => song.path)).toEqual([
      oldSong.path,
      newSong.path,
    ]);
  });
});
