import { reactive } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

type CoverKind = 'thumbnail' | 'full';

const THUMBNAIL_CACHE_LIMIT = 96;
const PRELOAD_CONCURRENCY = 4;

// Small in-memory LRU for thumbnail URLs. The actual image files live on disk.
const thumbnailCache = reactive(new Map<string, string>());
const loadingSet = reactive(new Set<string>());
const inFlightRequests = new Map<string, Promise<string>>();
const preloadQueue: string[] = [];
const queuedPaths = new Set<string>();

const getCacheForKind = (kind: CoverKind) =>
  kind === 'full' ? null : thumbnailCache;

const buildCacheKey = (path: string, kind: CoverKind) => `${kind}:${path}`;

const touchCacheEntry = (cache: Map<string, string>, path: string, value: string) => {
  if (cache.has(path)) {
    cache.delete(path);
  }
  cache.set(path, value);
};

const pruneCache = (cache: Map<string, string>, limit: number) => {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
};

const getCachedCover = (path: string, kind: CoverKind): string | undefined => {
  const cache = getCacheForKind(kind);
  if (!cache) {
    return undefined;
  }

  const cachedValue = cache.get(path);
  if (cachedValue === undefined) {
    return undefined;
  }

  touchCacheEntry(cache, path, cachedValue);
  return cachedValue;
};

const setCachedCover = (path: string, kind: CoverKind, value: string) => {
  const cache = getCacheForKind(kind);
  if (!cache) {
    return;
  }

  touchCacheEntry(cache, path, value);
  pruneCache(cache, THUMBNAIL_CACHE_LIMIT);
};

const loadCoverInternal = (path: string, kind: CoverKind): Promise<string> => {
  const requestKey = buildCacheKey(path, kind);
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    loadingSet.add(requestKey);
    try {
      const command = kind === 'full' ? 'get_song_cover' : 'get_song_cover_thumbnail';
      const coverPath = await invoke<string>(command, { path });
      const finalUrl = coverPath ? convertFileSrc(coverPath) : '';
      if (kind === 'thumbnail') {
        setCachedCover(path, kind, finalUrl);
      }
      return finalUrl;
    } catch {
      if (kind === 'thumbnail') {
        setCachedCover(path, kind, '');
      }
      return '';
    } finally {
      loadingSet.delete(requestKey);
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, request);
  return request;
};

const scheduleNextPreload = () => {
  while (loadingSet.size < PRELOAD_CONCURRENCY && preloadQueue.length > 0) {
    const path = preloadQueue.shift();
    if (!path) {
      continue;
    }

    queuedPaths.delete(path);

    if (thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail'))) {
      continue;
    }

    void loadCoverInternal(path, 'thumbnail').finally(() => {
      scheduleNextPreload();
    });
  }
};

export function useCoverCache() {
  const isCoverLoading = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) {
      return false;
    }

    return loadingSet.has(buildCacheKey(path, kind));
  };

  const loadCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCover(path, 'thumbnail');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return loadCoverInternal(path, 'thumbnail');
  };

  const loadFullCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCover(path, 'full');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return loadCoverInternal(path, 'full');
  };

  const preloadCovers = (paths: string[]) => {
    for (const path of paths) {
      if (!path || thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail')) || queuedPaths.has(path)) {
        continue;
      }

      queuedPaths.add(path);
      preloadQueue.push(path);
    }

    scheduleNextPreload();
  };

  return {
    coverCache: thumbnailCache,
    loadingSet,
    isCoverLoading,
    loadCover,
    loadFullCover,
    preloadCovers,
  };
}
