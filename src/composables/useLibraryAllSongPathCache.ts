import { ref } from 'vue';

import type { LocalSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;

const ALL_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_VIEW_PATH_CACHE_MAX_ENTRIES = 96;

const allViewPathCache = new MemoryCache<string, string[]>({
  maxEntries: ALL_VIEW_PATH_CACHE_MAX_ENTRIES,
  ttlMs: ALL_VIEW_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const makeCacheKey = (
  query: string,
  artistFilter: string,
  albumFilter: string,
  sortMode: BackendLocalSortMode,
) => `${sortMode}\u0001${query}\u0001${artistFilter}\u0001${albumFilter}`;

export function useLibraryAllSongPathCache() {
  const loadAllViewSongPaths = async ({
    query = '',
    artistFilter = '',
    albumFilter = '',
    sortMode,
  }: {
    query?: string;
    artistFilter?: string;
    albumFilter?: string;
    sortMode: BackendLocalSortMode;
  }) => {
    const cacheKey = makeCacheKey(query, artistFilter, albumFilter, sortMode);
    const cached = allViewPathCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = tauriInvoke('get_library_song_paths_for_all_view', {
      query,
      artistFilter,
      albumFilter,
      sortMode,
    })
      .then((paths) => {
        allViewPathCache.set(cacheKey, paths);
        cacheVersion.value += 1;
        return paths;
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, request);
    return request;
  };

  return {
    loadAllViewSongPaths,
    clearLibraryAllSongPathCache: () => {
      allViewPathCache.clear();
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryAllSongPathCacheVersion: cacheVersion,
  };
}
