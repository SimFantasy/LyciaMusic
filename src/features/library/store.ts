import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import type {
  AlbumSortMode,
  ArtistSortMode,
  FolderSortMode,
  LocalSortMode,
} from '../../services/storage/playerStorage';
import type {
  FolderNode,
  LibraryFolder,
  LibraryScanProgress,
  LibraryScanSession,
  Song,
} from '../../types';

const areSamePaths = (left: string[], right: string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

const resolveSharedPaths = (paths: string[], existing: string[], sibling: string[]) => {
  if (areSamePaths(existing, paths)) {
    return existing;
  }

  if (areSamePaths(sibling, paths)) {
    return sibling;
  }

  return paths;
};

export const useLibraryStore = defineStore('library', () => {
  const songPool = new Map<string, Song>();
  const songCatalogVersion = ref(0);

  const songKeys: Array<keyof Song> = [
    'id',
    'name',
    'title',
    'path',
    'artist',
    'artist_names',
    'effective_artist_names',
    'album',
    'album_artist',
    'album_key',
    'is_various_artists_album',
    'collapse_artist_credits',
    'duration',
    'genre',
    'year',
    'bitrate',
    'sample_rate',
    'bit_depth',
    'format',
    'container',
    'codec',
    'file_size',
    'added_at',
    'file_modified_at',
  ];

  const canonicalSongPaths = shallowRef<string[]>([]);
  const sourceSongPaths = shallowRef<string[]>([]);

  const syncSongRecord = (target: Song, source: Song) => {
    let changed = false;

    songKeys.forEach((key) => {
      const nextValue = source[key];
      const normalizedValue = Array.isArray(nextValue) ? [...nextValue] : nextValue;
      const prevValue = target[key];

      const isSameArray = Array.isArray(prevValue)
        && Array.isArray(normalizedValue)
        && prevValue.length === normalizedValue.length
        && prevValue.every((item, index) => item === normalizedValue[index]);

      if (prevValue === normalizedValue || isSameArray) {
        return;
      }

      (target as Record<keyof Song, unknown>)[key] = normalizedValue;
      changed = true;
    });

    return changed;
  };

  const internSong = (song: Song) => {
    const path = song?.path;
    if (!path) {
      return { song, changed: false };
    }

    const existing = songPool.get(path);
    if (!existing) {
      songPool.set(path, {
        ...song,
        artist_names: [...song.artist_names],
        effective_artist_names: [...song.effective_artist_names],
      });
      return { song: songPool.get(path) as Song, changed: true };
    }

    return {
      song: existing,
      changed: syncSongRecord(existing, song),
    };
  };

  const normalizeSongCollection = (songs: Song[]) => {
    const nextPaths: string[] = [];
    const seenPaths = new Set<string>();
    let changed = false;

    songs.forEach((song) => {
      if (!song?.path || seenPaths.has(song.path)) {
        return;
      }

      seenPaths.add(song.path);
      nextPaths.push(song.path);

      const interned = internSong(song);
      if (interned.changed) {
        changed = true;
      }
    });

    return { paths: nextPaths, changed };
  };

  const pruneSongPool = () => {
    const referencedPaths = new Set<string>([
      ...canonicalSongPaths.value,
      ...sourceSongPaths.value,
    ]);

    let removed = false;
    for (const path of songPool.keys()) {
      if (!referencedPaths.has(path)) {
        songPool.delete(path);
        removed = true;
      }
    }

    if (removed) {
      songCatalogVersion.value += 1;
    }
  };

  const materializeSongs = (paths: string[]) => {
    songCatalogVersion.value;
    return paths
      .map(path => songPool.get(path))
      .filter((song): song is Song => !!song);
  };

  const updateCanonicalSongPaths = (paths: string[], didChangeSongPool = false) => {
    const nextPaths = resolveSharedPaths(paths, canonicalSongPaths.value, sourceSongPaths.value);
    if (canonicalSongPaths.value !== nextPaths) {
      canonicalSongPaths.value = nextPaths;
    }

    if (didChangeSongPool) {
      songCatalogVersion.value += 1;
    }

    pruneSongPool();
  };

  const updateSourceSongPaths = (paths: string[], didChangeSongPool = false) => {
    const nextPaths = resolveSharedPaths(paths, sourceSongPaths.value, canonicalSongPaths.value);
    if (sourceSongPaths.value !== nextPaths) {
      sourceSongPaths.value = nextPaths;
    }

    if (didChangeSongPool) {
      songCatalogVersion.value += 1;
    }

    pruneSongPool();
  };

  const setCanonicalSongs = (songs: Song[]) => {
    const normalized = normalizeSongCollection(songs);
    updateCanonicalSongPaths(normalized.paths, normalized.changed);
  };

  const setSourceSongs = (songs: Song[]) => {
    const normalized = normalizeSongCollection(songs);
    updateSourceSongPaths(normalized.paths, normalized.changed);
  };

  const setSongRecord = (song: Song) => {
    const interned = internSong(song);
    if (interned.changed) {
      songCatalogVersion.value += 1;
    }
  };

  const getSongByPath = (path: string | null | undefined, fallback?: Song | null) => {
    if (!path) {
      return fallback ?? null;
    }

    return songPool.get(path) ?? fallback ?? null;
  };

  const resolveSongsByPaths = (paths: string[], fallbackSongs: Song[] = []) => {
    const fallbackLookup = new Map<string, Song>();
    fallbackSongs.forEach((song) => {
      if (song?.path && !fallbackLookup.has(song.path)) {
        fallbackLookup.set(song.path, song);
      }
    });

    return paths
      .map(path => getSongByPath(path, fallbackLookup.get(path)))
      .filter((song): song is Song => !!song);
  };

  const songLookup = computed(() => {
    songCatalogVersion.value;
    return songPool;
  });

  const canonicalSongs = computed<Song[]>({
    get: () => materializeSongs(canonicalSongPaths.value),
    set: setCanonicalSongs,
  });

  const sourceSongs = computed<Song[]>({
    get: () => materializeSongs(sourceSongPaths.value),
    set: setSourceSongs,
  });

  const libraryFolders = ref<LibraryFolder[]>([]);
  const libraryHierarchy = ref<FolderNode[]>([]);
  const libraryScanProgress = ref<LibraryScanProgress | null>(null);
  const libraryScanSession = ref<LibraryScanSession | null>(null);
  const lastLibraryScanError = ref<string | null>(null);
  const watchedFolders = ref<string[]>([]);
  const artistSortMode = ref<ArtistSortMode>('name');
  const albumSortMode = ref<AlbumSortMode>('name');
  const artistCustomOrder = ref<string[]>([]);
  const albumCustomOrder = ref<string[]>([]);
  const folderSortMode = ref<FolderSortMode>('title');
  const folderCustomOrder = ref<Record<string, string[]>>({});
  const localSortMode = ref<LocalSortMode>('title');
  const localCustomOrder = ref<string[]>([]);

  const setLibraryFolders = (folders: LibraryFolder[]) => {
    libraryFolders.value = folders;
  };

  const setLibraryHierarchy = (tree: FolderNode[]) => {
    libraryHierarchy.value = tree;
  };

  const setLibraryScanProgress = (progress: LibraryScanProgress | null) => {
    libraryScanProgress.value = progress;
  };

  const setLibraryScanSession = (session: LibraryScanSession | null) => {
    libraryScanSession.value = session;
  };

  const setLastLibraryScanError = (message: string | null) => {
    lastLibraryScanError.value = message;
  };

  const setWatchedFolders = (paths: string[]) => {
    watchedFolders.value = paths;
  };

  const reorderWatchedFolders = (from: number, to: number) => {
    const list = [...watchedFolders.value];
    const [removed] = list.splice(from, 1);
    if (!removed) {
      return;
    }

    list.splice(to, 0, removed);
    watchedFolders.value = list;
  };

  return {
    canonicalSongs,
    canonicalSongPaths,
    sourceSongs,
    sourceSongPaths,
    songLookup,
    getSongByPath,
    resolveSongsByPaths,
    setSongRecord,
    libraryFolders,
    libraryHierarchy,
    songList: sourceSongs,
    librarySongs: canonicalSongs,
    folderTree: libraryHierarchy,
    libraryScanProgress,
    libraryScanSession,
    lastLibraryScanError,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
    setSourceSongs,
    setCanonicalSongs,
    setLibraryFolders,
    setLibraryHierarchy,
    setSongList: setSourceSongs,
    setLibrarySongs: setCanonicalSongs,
    setFolderTree: setLibraryHierarchy,
    setLibraryScanProgress,
    setLibraryScanSession,
    setLastLibraryScanError,
    setWatchedFolders,
    reorderWatchedFolders,
  };
});
