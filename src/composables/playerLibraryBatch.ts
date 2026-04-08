import { storeToRefs } from 'pinia';
import type { Song } from '../types';

import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';

const LIBRARY_SCAN_BATCH_FLUSH_MS = 120;

interface CreatePlayerLibraryBatchDeps {
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
}

export const createPlayerLibraryBatch = ({
  createSongLookup,
}: CreatePlayerLibraryBatchDeps) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { sourceSongs, canonicalSongs } = storeToRefs(libraryStore);
  const { playQueue, currentSong } = storeToRefs(playbackStore);
  let libraryScanBatchFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingLibraryScanSongs = new Map<string, Song>();
  const pendingLibraryScanDeletedPaths = new Set<string>();
  const pendingLibraryScanFallbackSongs = new Map<string, Song>();

  const refreshStateSongReferences = (fallbackSongs: Song[] = []) => {
    const lookup = createSongLookup([
      ...fallbackSongs,
      ...sourceSongs.value,
      ...playQueue.value,
      ...(currentSong.value ? [currentSong.value] : []),
    ]);

    sourceSongs.value = sourceSongs.value
      .map(song => lookup.get(song.path) ?? song)
      .filter((song): song is Song => !!song);
    playQueue.value = playQueue.value
      .map(song => lookup.get(song.path) ?? song)
      .filter((song): song is Song => !!song);

    if (currentSong.value?.path) {
      currentSong.value = lookup.get(currentSong.value.path) ?? currentSong.value;
    }
  };

  const flushBufferedLibraryScanBatch = () => {
    if (libraryScanBatchFlushTimer) {
      clearTimeout(libraryScanBatchFlushTimer);
      libraryScanBatchFlushTimer = null;
    }

    if (pendingLibraryScanSongs.size === 0 && pendingLibraryScanDeletedPaths.size === 0) {
      pendingLibraryScanFallbackSongs.clear();
      return;
    }

    const merged = new Map<string, Song>();
    for (const song of canonicalSongs.value) {
      if (!pendingLibraryScanDeletedPaths.has(song.path)) {
        merged.set(song.path, song);
      }
    }

    for (const [path, song] of pendingLibraryScanSongs) {
      if (!pendingLibraryScanDeletedPaths.has(path)) {
        merged.set(path, song);
      }
    }

    canonicalSongs.value = Array.from(merged.values());
    refreshStateSongReferences(Array.from(pendingLibraryScanFallbackSongs.values()));

    pendingLibraryScanSongs.clear();
    pendingLibraryScanDeletedPaths.clear();
    pendingLibraryScanFallbackSongs.clear();
  };

  const scheduleLibraryScanBatchFlush = () => {
    if (libraryScanBatchFlushTimer) return;
    libraryScanBatchFlushTimer = setTimeout(() => {
      flushBufferedLibraryScanBatch();
    }, LIBRARY_SCAN_BATCH_FLUSH_MS);
  };

  const applyLibraryScanBatch = (payload: {
    songs: Song[];
    deleted_paths: string[];
  }) => {
    const incomingSongs = Array.isArray(payload.songs) ? payload.songs : [];

    for (const deletedPath of payload.deleted_paths ?? []) {
      pendingLibraryScanDeletedPaths.add(deletedPath);
      pendingLibraryScanSongs.delete(deletedPath);
      pendingLibraryScanFallbackSongs.delete(deletedPath);
    }

    for (const song of incomingSongs) {
      if (!song?.path) continue;
      pendingLibraryScanDeletedPaths.delete(song.path);
      pendingLibraryScanSongs.set(song.path, song);
      pendingLibraryScanFallbackSongs.set(song.path, song);
    }

    scheduleLibraryScanBatchFlush();
  };

  const dispose = () => {
    if (libraryScanBatchFlushTimer) {
      clearTimeout(libraryScanBatchFlushTimer);
      libraryScanBatchFlushTimer = null;
    }
    pendingLibraryScanSongs.clear();
    pendingLibraryScanDeletedPaths.clear();
    pendingLibraryScanFallbackSongs.clear();
  };

  return {
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    dispose,
  };
};
