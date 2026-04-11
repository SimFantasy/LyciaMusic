import { reactive } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { MemoryCache } from '../utils/MemoryCache';

type CoverKind = 'thumbnail' | 'full';
type PreloadPriority = 'priority' | 'background';

const THUMBNAIL_CACHE_LIMIT = 96;
const FULL_COVER_CACHE_LIMIT = 12;
const PRELOAD_CONCURRENCY = 4;
const BACKGROUND_PRELOAD_CONCURRENCY = 1;
const FAILURE_RETRY_MS = 10_000;

// Small in-memory LRU for thumbnail URLs. The actual image files live on disk.
const thumbnailCache = reactive(new Map<string, string>());
const fullCoverCache = reactive(new Map<string, string>());
const loadingSet = reactive(new Set<string>());
const inFlightRequests = new Map<string, Promise<string>>();
const recentFailureCache = new MemoryCache<string, true>({
  maxEntries: 256,
  ttlMs: FAILURE_RETRY_MS,
});
const priorityPreloadQueue: string[] = [];
const backgroundPreloadQueue: string[] = [];
const queuedPathPriority = new Map<string, PreloadPriority>();
let backgroundPreloadTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundPreloadIdleId: number | null = null;
let hasRegisteredVisibilityCleanup = false;

const getCacheForKind = (kind: CoverKind) =>
  kind === 'full' ? fullCoverCache : thumbnailCache;

const buildCacheKey = (path: string, kind: CoverKind) => `${kind}:${path}`;
const isThumbnailRequestKey = (requestKey: string) => requestKey.startsWith('thumbnail:');

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
  pruneCache(cache, kind === 'full' ? FULL_COVER_CACHE_LIMIT : THUMBNAIL_CACHE_LIMIT);
};

const getFailureCacheKey = (path: string, kind: CoverKind) => buildCacheKey(path, kind);

const hasRecentFailure = (path: string, kind: CoverKind) => {
  const cacheKey = getFailureCacheKey(path, kind);
  return recentFailureCache.has(cacheKey);
};

const trimTransientCoverState = () => {
  fullCoverCache.clear();
  priorityPreloadQueue.length = 0;
  backgroundPreloadQueue.length = 0;
  queuedPathPriority.clear();
  cancelBackgroundPreload();
  recentFailureCache.prune();
};

const registerVisibilityCleanup = () => {
  if (hasRegisteredVisibilityCleanup || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      trimTransientCoverState();
    }
  });
  hasRegisteredVisibilityCleanup = true;
};

const loadCoverInternal = (path: string, kind: CoverKind): Promise<string> => {
  const requestKey = buildCacheKey(path, kind);
  if (hasRecentFailure(path, kind)) {
    return Promise.resolve('');
  }

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
      recentFailureCache.delete(requestKey);
      if (finalUrl) {
        setCachedCover(path, kind, finalUrl);
      }
      return finalUrl;
    } catch {
      recentFailureCache.set(requestKey, true);
      return '';
    } finally {
      loadingSet.delete(requestKey);
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, request);
  return request;
};

const getActiveThumbnailLoadCount = () => {
  let activeCount = 0;
  for (const requestKey of loadingSet) {
    if (isThumbnailRequestKey(requestKey)) {
      activeCount += 1;
    }
  }
  return activeCount;
};

const cancelBackgroundPreload = () => {
  if (backgroundPreloadTimer) {
    clearTimeout(backgroundPreloadTimer);
    backgroundPreloadTimer = null;
  }

  if (backgroundPreloadIdleId !== null && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(backgroundPreloadIdleId);
    backgroundPreloadIdleId = null;
  }
};

const dequeueNextPath = (priority: PreloadPriority) => {
  const queue = priority === 'priority' ? priorityPreloadQueue : backgroundPreloadQueue;

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) {
      continue;
    }

    if (queuedPathPriority.get(path) !== priority) {
      continue;
    }

    queuedPathPriority.delete(path);
    return path;
  }

  return undefined;
};

const startPreload = (path: string) => {
  if (thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail'))) {
    return;
  }

  void loadCoverInternal(path, 'thumbnail').finally(() => {
    schedulePriorityPreload();
    scheduleBackgroundPreload();
  });
};

const schedulePriorityPreload = () => {
  cancelBackgroundPreload();

  while (getActiveThumbnailLoadCount() < PRELOAD_CONCURRENCY) {
    const nextPath = dequeueNextPath('priority');
    if (!nextPath) {
      break;
    }

    startPreload(nextPath);
  }
};

const flushBackgroundPreload = () => {
  backgroundPreloadTimer = null;
  backgroundPreloadIdleId = null;

  if (priorityPreloadQueue.length > 0) {
    schedulePriorityPreload();
    return;
  }

  while (getActiveThumbnailLoadCount() < BACKGROUND_PRELOAD_CONCURRENCY) {
    const nextPath = dequeueNextPath('background');
    if (!nextPath) {
      break;
    }

    startPreload(nextPath);
  }

  if (backgroundPreloadQueue.length > 0) {
    scheduleBackgroundPreload();
  }
};

function scheduleBackgroundPreload() {
  if (
    backgroundPreloadTimer ||
    backgroundPreloadIdleId !== null ||
    priorityPreloadQueue.length > 0 ||
    backgroundPreloadQueue.length === 0 ||
    getActiveThumbnailLoadCount() >= BACKGROUND_PRELOAD_CONCURRENCY
  ) {
    return;
  }

  const runBackgroundPreload = () => {
    flushBackgroundPreload();
  };

  if ('requestIdleCallback' in window) {
    backgroundPreloadIdleId = window.requestIdleCallback(runBackgroundPreload, { timeout: 300 });
    return;
  }

  backgroundPreloadTimer = setTimeout(runBackgroundPreload, 160);
}

const enqueuePreload = (path: string, priority: PreloadPriority) => {
  if (!path || thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail'))) {
    return;
  }

  const existingPriority = queuedPathPriority.get(path);
  if (existingPriority === 'priority') {
    return;
  }

  if (priority === 'priority') {
    queuedPathPriority.set(path, 'priority');
    priorityPreloadQueue.push(path);
    return;
  }

  if (!existingPriority) {
    queuedPathPriority.set(path, 'background');
    backgroundPreloadQueue.push(path);
  }
};

export function useCoverCache() {
  registerVisibilityCleanup();

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

  const preloadCovers = (paths: string[], priority: PreloadPriority = 'background') => {
    for (const path of paths) {
      enqueuePreload(path, priority);
    }

    if (priority === 'priority') {
      schedulePriorityPreload();
      return;
    }

    scheduleBackgroundPreload();
  };

  const clearCoverCaches = () => {
    thumbnailCache.clear();
    fullCoverCache.clear();
    loadingSet.clear();
    inFlightRequests.clear();
    recentFailureCache.clear();
    priorityPreloadQueue.length = 0;
    backgroundPreloadQueue.length = 0;
    queuedPathPriority.clear();
    cancelBackgroundPreload();
  };

  return {
    coverCache: thumbnailCache,
    fullCoverCache,
    loadingSet,
    isCoverLoading,
    loadCover,
    loadFullCover,
    preloadCovers,
    preloadPriorityCovers: (paths: string[]) => preloadCovers(paths, 'priority'),
    clearCoverCaches,
  };
}
