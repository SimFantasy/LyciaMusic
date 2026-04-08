import { ref, shallowRef } from 'vue';
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
