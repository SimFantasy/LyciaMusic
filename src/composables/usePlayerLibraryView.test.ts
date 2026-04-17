import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';

const tauriInvokeMock = vi.fn();

vi.mock('../services/tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

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

const normalizeArtistNames = (song: Song) =>
  song.effective_artist_names.length > 0
    ? song.effective_artist_names
    : song.artist_names.length > 0
      ? song.artist_names
      : [song.artist];

const resolveAlbumKey = (song: Song) =>
  song.album_key || `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;

const songMatchesQuery = (song: Song, query: string) => {
  const loweredQuery = query.trim().toLowerCase();
  if (!loweredQuery) {
    return true;
  }

  return song.name.toLowerCase().includes(loweredQuery)
    || song.title?.toLowerCase().includes(loweredQuery)
    || song.artist.toLowerCase().includes(loweredQuery)
    || song.album.toLowerCase().includes(loweredQuery)
    || song.album_artist.toLowerCase().includes(loweredQuery)
    || normalizeArtistNames(song).some(name => name.toLowerCase().includes(loweredQuery));
};

const sortSongs = (songs: Song[], mode: string) => {
  const sorted = [...songs];

  if (mode === 'title') {
    sorted.sort((left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'));
  } else if (mode === 'artist') {
    sorted.sort((left, right) => left.artist.localeCompare(right.artist, 'zh-CN'));
  } else if (mode === 'added_at') {
    sorted.sort((left, right) => (right.added_at || 0) - (left.added_at || 0));
  } else if (mode === 'added_at_asc') {
    sorted.sort((left, right) => (left.added_at || 0) - (right.added_at || 0));
  } else if (mode === 'file_modified_at') {
    sorted.sort((left, right) => (right.file_modified_at || 0) - (left.file_modified_at || 0));
  } else if (mode === 'file_modified_at_asc') {
    sorted.sort((left, right) => (left.file_modified_at || 0) - (right.file_modified_at || 0));
  }

  return sorted;
};

const isDirectParent = (parentPath: string, childPath: string) => {
  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedChild = childPath.replace(/\\/g, '/');
  const lastSlash = normalizedChild.lastIndexOf('/');

  return lastSlash !== -1 && normalizedChild.substring(0, lastSlash) === normalizedParent;
};

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('player library view', () => {
  beforeEach(() => {
    tauriInvokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      const libraryStore = useLibraryStore();
      const songs = libraryStore.canonicalSongs;
      const songLookup = new Map(songs.map(song => [song.path, song] as const));

      if (command === 'get_library_song_paths_for_all_view') {
        const query = String(payload?.query ?? '').trim().toLowerCase();
        const artistFilter = String(payload?.artistFilter ?? '');
        const albumFilter = String(payload?.albumFilter ?? '');
        const sortMode = String(payload?.sortMode ?? 'title');
        let filtered = songs.filter(song => songMatchesQuery(song, query));

        if (artistFilter) {
          filtered = filtered.filter(song => normalizeArtistNames(song).includes(artistFilter));
        }

        if (albumFilter) {
          filtered = filtered.filter(song => resolveAlbumKey(song) === albumFilter);
        }

        return sortSongs(filtered, sortMode).map(song => song.path);
      }

      if (command === 'get_library_song_paths_by_artist') {
        const artistName = String(payload?.artistName ?? '');
        return songs
          .filter(song => normalizeArtistNames(song).includes(artistName))
          .sort((left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'))
          .map(song => song.path);
      }

      if (command === 'get_library_song_paths_by_album') {
        const albumKey = String(payload?.albumKey ?? '');
        return songs
          .filter(song => resolveAlbumKey(song) === albumKey)
          .sort((left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'))
          .map(song => song.path);
      }

      if (command === 'get_favorite_artist_catalog') {
        const favoritePaths = new Set((payload?.favoritePaths as string[] | undefined) ?? []);
        const map = new Map<string, { count: number; firstSongPath: string }>();

        songs.filter(song => favoritePaths.has(song.path)).forEach(song => {
          normalizeArtistNames(song).forEach(name => {
            const entry = map.get(name) ?? { count: 0, firstSongPath: song.path };
            entry.count += 1;
            map.set(name, entry);
          });
        });

        return Array.from(map.entries()).map(([name, value]) => ({
          name,
          count: value.count,
          firstSongPath: value.firstSongPath,
        }));
      }

      if (command === 'get_favorite_album_catalog') {
        const favoritePaths = new Set((payload?.favoritePaths as string[] | undefined) ?? []);
        const map = new Map<string, { key: string; name: string; count: number; artist: string; firstSongPath: string }>();

        songs.filter(song => favoritePaths.has(song.path)).forEach(song => {
          const key = resolveAlbumKey(song);
          const entry = map.get(key) ?? {
            key,
            name: song.album,
            count: 0,
            artist: song.album_artist || song.artist,
            firstSongPath: song.path,
          };
          entry.count += 1;
          map.set(key, entry);
        });

        return Array.from(map.values());
      }

      if (command === 'get_favorite_song_paths_view') {
        const favoritePaths = new Set((payload?.favoritePaths as string[] | undefined) ?? []);
        const query = String(payload?.query ?? '').trim().toLowerCase();
        const sortMode = String(payload?.sortMode ?? 'title');
        const detailFilterType = payload?.detailFilterType as 'artist' | 'album' | undefined;
        const detailFilterValue = payload?.detailFilterValue as string | undefined;
        let filtered = songs.filter(song => favoritePaths.has(song.path) && songMatchesQuery(song, query));

        if (detailFilterType === 'artist' && detailFilterValue) {
          filtered = filtered.filter(song => normalizeArtistNames(song).includes(detailFilterValue));
        }

        if (detailFilterType === 'album' && detailFilterValue) {
          filtered = filtered.filter(song => resolveAlbumKey(song) === detailFilterValue);
        }

        return sortSongs(filtered, sortMode).map(song => song.path);
      }

      if (command === 'get_recent_song_paths_view') {
        const recentEntries = (payload?.recentEntries as { songPath: string; playedAt: number }[] | undefined) ?? [];
        const query = String(payload?.query ?? '').trim().toLowerCase();
        const sortMode = String(payload?.sortMode ?? 'title');
        const uniquePaths = Array.from(new Set(recentEntries.map(item => item.songPath)));
        const filtered = uniquePaths
          .map(path => songLookup.get(path))
          .filter((song): song is Song => !!song)
          .filter(song => songMatchesQuery(song, query));

        return sortSongs(filtered, sortMode).map(song => song.path);
      }

      if (command === 'get_library_song_paths_for_folder_view') {
        const folderPath = String(payload?.folderPath ?? '');
        const query = String(payload?.query ?? '').trim().toLowerCase();
        const sortMode = String(payload?.sortMode ?? 'title');
        const filtered = songs
          .filter(song => isDirectParent(folderPath, song.path))
          .filter(song => songMatchesQuery(song, query));

        return sortSongs(filtered, sortMode === 'name' ? 'title' : sortMode).map(song => song.path);
      }

      if (command === 'get_recent_album_catalog' || command === 'get_recent_playlist_catalog') {
        return [];
      }

      return [];
    });

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

  it('filters folder songs to direct children and keeps custom folder order', async () => {
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
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      secondSong.path,
      firstSong.path,
    ]);
  });

  it('applies favorites detail filters and local sorting rules', async () => {
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
    await flushPromises();

    expect(displaySongList.value.map(song => song.title)).toEqual(['Alpha', 'Zebra']);
    expect(favArtistList.value.map(item => item.name)).toContain('Target Artist');
    expect(favArtistList.value.find(item => item.name === 'Target Artist')?.count).toBe(2);
  });

  it('resolves recent songs from path-backed history entries', async () => {
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
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      alpha.path,
      beta.path,
    ]);
  });

  it('sorts local music by file modified time in both directions', async () => {
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
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      newSong.path,
      oldSong.path,
    ]);

    libraryStore.localSortMode = 'file_modified_at_asc';
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      oldSong.path,
      newSong.path,
    ]);
  });

  it('applies local sorting rules in album detail view', async () => {
    const libraryStore = useLibraryStore();
    const navigationStore = useNavigationStore();
    const earlySong = makeSong({
      path: '/music/album/early.flac',
      title: 'Early',
      album: 'Detail Album',
      album_key: 'detail-album::artist',
      added_at: 10,
    });
    const lateSong = makeSong({
      path: '/music/album/late.flac',
      title: 'Late',
      album: 'Detail Album',
      album_key: 'detail-album::artist',
      added_at: 30,
    });

    libraryStore.librarySongs = [earlySong, lateSong];
    navigationStore.currentViewMode = 'album';
    navigationStore.filterCondition = 'detail-album::artist';
    libraryStore.localSortMode = 'added_at';

    const { displaySongList } = usePlayerLibraryView();
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      lateSong.path,
      earlySong.path,
    ]);

    libraryStore.localSortMode = 'added_at_asc';
    await flushPromises();

    expect(displaySongList.value.map(song => song.path)).toEqual([
      earlySong.path,
      lateSong.path,
    ]);
  });
});
