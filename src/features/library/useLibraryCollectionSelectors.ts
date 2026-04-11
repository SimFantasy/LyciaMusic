import { computed, type ComputedRef, type Ref } from 'vue';

import type { HistoryItem, Playlist, Song } from '../../types';
import { compareByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  getSongAlbumKey,
  getSongArtistNames,
  type AlbumListItem,
  type ArtistListItem,
} from './playerLibraryViewShared';

interface RecentPlaylistListItem {
  id: string;
  name: string;
  count: number;
  playedAt: number;
  firstSongPath: string;
}

interface UseLibraryCollectionSelectorsOptions {
  canonicalSongPaths: Ref<string[]>;
  favoritePaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
}

export function useLibraryCollectionSelectors({
  canonicalSongPaths,
  favoritePaths,
  playlists,
  recentSongs,
  songLookup,
}: UseLibraryCollectionSelectorsOptions) {
  const favoriteSongPaths = computed(() => {
    const favoritePathSet = new Set(favoritePaths.value);
    return canonicalSongPaths.value.filter(path => favoritePathSet.has(path) && songLookup.value.has(path));
  });

  const favoriteSongList = computed(() =>
    favoriteSongPaths.value
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song),
  );

  const favArtistList = computed<ArtistListItem[]>(() => {
    const map = new Map<string, { count: number; firstSongPath: string }>();

    favoriteSongPaths.value.forEach((path) => {
      const song = songLookup.value.get(path);
      if (!song) {
        return;
      }

      getSongArtistNames(song).forEach(name => {
        const existing = map.get(name);
        if (existing) {
          existing.count += 1;
          return;
        }

        map.set(name, { count: 1, firstSongPath: song.path });
      });
    });

    return Array.from(map, ([name, value]) => ({
      name,
      count: value.count,
      firstSongPath: value.firstSongPath,
    })).sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.name, b.name));
  });

  const favAlbumList = computed<AlbumListItem[]>(() => {
    const map = new Map<string, AlbumListItem>();

    favoriteSongPaths.value.forEach((path) => {
      const song = songLookup.value.get(path);
      if (!song) {
        return;
      }

      const key = getSongAlbumKey(song);
      const existing = map.get(key);

      if (existing) {
        existing.count += 1;
        return;
      }

      map.set(key, {
        key,
        name: song.album || 'Unknown',
        count: 1,
        artist: song.album_artist || song.artist || 'Unknown',
        firstSongPath: song.path,
      });
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.artist, b.artist));
  });

  const recentAlbumList = computed(() => {
    const map = new Map<string, { key: string; name: string; artist: string; playedAt: number; firstSongPath: string }>();

    recentSongs.value.forEach(item => {
      const song = songLookup.value.get(item.path);
      if (!song) {
        return;
      }

      const key = getSongAlbumKey(song);
      if (!map.has(key) || item.playedAt > map.get(key)!.playedAt) {
        map.set(key, {
          key,
          name: song.album || 'Unknown',
          artist: song.album_artist || song.artist || 'Unknown',
          playedAt: item.playedAt,
          firstSongPath: song.path,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.playedAt - a.playedAt);
  });

  const recentPlaylistList = computed<RecentPlaylistListItem[]>(() => {
    const result: RecentPlaylistListItem[] = [];

    playlists.value.forEach(playlist => {
      let lastPlayedTime = 0;
      let hasPlayed = false;
      const playlistSongPaths = new Set(playlist.songPaths);

      for (const historyItem of recentSongs.value) {
        if (!playlistSongPaths.has(historyItem.path)) {
          continue;
        }

        if (historyItem.playedAt > lastPlayedTime) {
          lastPlayedTime = historyItem.playedAt;
          hasPlayed = true;
        }
      }

      if (hasPlayed) {
        result.push({
          id: playlist.id,
          name: playlist.name,
          count: playlist.songPaths.length,
          playedAt: lastPlayedTime,
          firstSongPath: playlist.songPaths.length > 0 ? playlist.songPaths[0] : '',
        });
      }
    });

    return result.sort((a, b) => b.playedAt - a.playedAt);
  });

  return {
    favoriteSongPaths,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
  };
}
