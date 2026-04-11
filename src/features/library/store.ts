import { ref, shallowRef, watch } from 'vue';
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

export const useLibraryStore = defineStore('library', () => {
  const songPool = new Map<string, Song>();
  let isNormalizingSongState = false;

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

  const syncSongRecord = (target: Song, source: Song) => {
    songKeys.forEach((key) => {
      const value = source[key];
      if (Array.isArray(value)) {
        (target as Record<keyof Song, unknown>)[key] = [...value];
        return;
      }

      (target as Record<keyof Song, unknown>)[key] = value;
    });
  };

  const internSong = (song: Song): Song => {
    const path = song?.path;
    if (!path) {
      return song;
    }

    const existing = songPool.get(path);
    if (!existing) {
      songPool.set(path, song);
      return song;
    }

    if (existing !== song) {
      syncSongRecord(existing, song);
    }

    return existing;
  };

  const internSongs = (songs: Song[]) => {
    const normalized: Song[] = [];
    const seenPaths = new Set<string>();

    songs.forEach((song) => {
      if (!song?.path || seenPaths.has(song.path)) {
        return;
      }

      seenPaths.add(song.path);
      normalized.push(internSong(song));
    });

    return normalized;
  };

  const areSameSongRefs = (left: Song[], right: Song[]) =>
    left.length === right.length && left.every((song, index) => song === right[index]);

  const pruneSongPool = () => {
    const referencedPaths = new Set<string>();
    canonicalSongs.value.forEach((song) => {
      if (song?.path) {
        referencedPaths.add(song.path);
      }
    });
    sourceSongs.value.forEach((song) => {
      if (song?.path) {
        referencedPaths.add(song.path);
      }
    });

    for (const path of songPool.keys()) {
      if (!referencedPaths.has(path)) {
        songPool.delete(path);
      }
    }
  };

  const normalizeSongState = () => {
    if (isNormalizingSongState) {
      return;
    }

    isNormalizingSongState = true;
    try {
      const normalizedCanonical = internSongs(canonicalSongs.value);
      if (!areSameSongRefs(canonicalSongs.value, normalizedCanonical)) {
        canonicalSongs.value = normalizedCanonical;
      }

      const normalizedSource = internSongs(sourceSongs.value);
      if (!areSameSongRefs(sourceSongs.value, normalizedSource)) {
        sourceSongs.value = normalizedSource;
      }

      pruneSongPool();
    } finally {
      isNormalizingSongState = false;
    }
  };

  // Canonical library catalog data indexed from library_folders.
  const canonicalSongs = shallowRef<Song[]>([]);
  // File-system-backed source snapshot used by folder browsing and file operations.
  const sourceSongs = shallowRef<Song[]>([]);
  const libraryFolders = ref<LibraryFolder[]>([]);
  // Directory hierarchy derived from the current library roots.
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

  const setSourceSongs = (songs: Song[]) => {
    sourceSongs.value = songs;
  };

  const setCanonicalSongs = (songs: Song[]) => {
    canonicalSongs.value = songs;
  };

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

  watch([canonicalSongs, sourceSongs], normalizeSongState, {
    flush: 'sync',
  });

  return {
    canonicalSongs,
    sourceSongs,
    libraryFolders,
    libraryHierarchy,
    // Compatibility aliases while callers migrate to the semantic names above.
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
    // Compatibility aliases while callers migrate to the semantic setters above.
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
