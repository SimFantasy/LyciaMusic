import { MemoryCache } from '../utils/MemoryCache';

export const artistHeaderCache = new MemoryCache<string, string>({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000,
});

export const albumHeaderCache = new MemoryCache<string, string>({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000,
});

export const sidebarPlaylistCoverCache = new MemoryCache<string, string>({
  maxEntries: 80,
  ttlMs: 5 * 60 * 1000,
});

export const listScrollCache = new MemoryCache<string, number>({
  maxEntries: 30,
  ttlMs: 30 * 60 * 1000,
});
