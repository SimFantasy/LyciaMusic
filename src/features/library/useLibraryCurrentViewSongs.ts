import { computed, type ComputedRef, type Ref } from 'vue';

import type { LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  getSongArtistSearchText,
  getSongTitleLabel,
  matchesAlbumKey,
  songHasArtist,
} from './playerLibraryViewShared';

interface UseLibraryCurrentViewSongsOptions {
  canonicalSongPaths: Ref<string[]>;
  sourceSongPaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
  favoriteSongPaths: ComputedRef<string[]>;
  currentFolderSongPaths: ComputedRef<string[]>;
  currentViewMode: Ref<string>;
  searchQuery: Ref<string>;
  localMusicTab: Ref<'default' | 'artist' | 'album'>;
  currentArtistFilter: Ref<string>;
  currentAlbumFilter: Ref<string>;
  filterCondition: Ref<string>;
  favTab: Ref<'songs' | 'artists' | 'albums'>;
  favDetailFilter: Ref<{ type: 'artist' | 'album'; name: string } | null>;
  localSortMode: Ref<LocalSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

export function useLibraryCurrentViewSongs({
  canonicalSongPaths,
  sourceSongPaths,
  playlists,
  recentSongs,
  songLookup,
  favoriteSongPaths,
  currentFolderSongPaths,
  currentViewMode,
  searchQuery,
  localMusicTab,
  currentArtistFilter,
  currentAlbumFilter,
  filterCondition,
  favTab,
  favDetailFilter,
  localSortMode,
  localCustomOrder,
  playlistSortMode,
}: UseLibraryCurrentViewSongsOptions) {
  const resolveRecentSongPaths = () =>
    recentSongs.value
      .map(item => item.path)
      .filter(path => songLookup.value.has(path));

  const materializeSongPaths = (paths: string[]) =>
    paths
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song);

  const sortSongPathsByLocalMode = (paths: string[], mode: LocalSortMode) => {
    const sortedPaths = [...paths];

    if (mode === 'title') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
          songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
          'zh-CN',
        ),
      );
    } else if (mode === 'artist') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
      );
    } else if (mode === 'added_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
      );
    } else if (mode === 'added_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
      );
    } else if (mode === 'file_modified_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.file_modified_at || 0) - (songLookup.value.get(left)?.file_modified_at || 0),
      );
    } else if (mode === 'file_modified_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.file_modified_at || 0) - (songLookup.value.get(right)?.file_modified_at || 0),
      );
    }

    return sortedPaths;
  };

  const currentViewSongPaths = computed(() => {
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase();
      const matchesQuery = (path: string) => {
        const song = songLookup.value.get(path);
        if (!song) {
          return false;
        }

        return song.name.toLowerCase().includes(query)
          || getSongArtistSearchText(song).includes(query)
          || song.album.toLowerCase().includes(query);
      };

      if (currentViewMode.value === 'favorites') {
        return favoriteSongPaths.value.filter(matchesQuery);
      }

      if (currentViewMode.value === 'recent') {
        return resolveRecentSongPaths().filter(matchesQuery);
      }

      if (currentViewMode.value === 'all') {
        return sortItemsByAlphabetIndex(
          canonicalSongPaths.value.filter(matchesQuery),
          (path) => getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      if (currentViewMode.value === 'folder') {
        return sortItemsByAlphabetIndex(
          sourceSongPaths.value.filter(matchesQuery),
          (path) => getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      return canonicalSongPaths.value.filter(matchesQuery);
    }

    if (currentViewMode.value === 'all') {
      let base = [...canonicalSongPaths.value];
      if (localMusicTab.value === 'artist' && currentArtistFilter.value) {
        base = base.filter(path => songHasArtist(songLookup.value.get(path)!, currentArtistFilter.value));
      } else if (localMusicTab.value === 'album' && currentAlbumFilter.value) {
        base = base.filter(path => matchesAlbumKey(songLookup.value.get(path)!, currentAlbumFilter.value));
      }

      if (localSortMode.value === 'title') {
        base = sortItemsByAlphabetIndex(base, (path) => getSongTitleLabel(songLookup.value.get(path)!));
      } else if (localSortMode.value === 'artist') {
        base.sort((left, right) =>
          (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
        );
      } else if (localSortMode.value === 'added_at') {
        base.sort((left, right) => (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0));
      } else if (localSortMode.value === 'added_at_asc') {
        base.sort((left, right) => (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0));
      } else if (localSortMode.value === 'file_modified_at') {
        base.sort((left, right) => (songLookup.value.get(right)?.file_modified_at || 0) - (songLookup.value.get(left)?.file_modified_at || 0));
      } else if (localSortMode.value === 'file_modified_at_asc') {
        base.sort((left, right) => (songLookup.value.get(left)?.file_modified_at || 0) - (songLookup.value.get(right)?.file_modified_at || 0));
      } else if (localSortMode.value === 'custom') {
        const orderMap = new Map(localCustomOrder.value.map((path, index) => [path, index]));
        base.sort((left, right) => {
          const leftIndex = orderMap.has(left) ? orderMap.get(left)! : Number.MAX_SAFE_INTEGER;
          const rightIndex = orderMap.has(right) ? orderMap.get(right)! : Number.MAX_SAFE_INTEGER;
          return leftIndex - rightIndex;
        });
      } else {
        base = sortItemsByAlphabetIndex(base, (path) => getSongTitleLabel(songLookup.value.get(path)!));
      }

      return base;
    }

    if (currentViewMode.value === 'folder') {
      return currentFolderSongPaths.value;
    }

    if (currentViewMode.value === 'recent') {
      return sortSongPathsByLocalMode(resolveRecentSongPaths(), localSortMode.value);
    }

    if (currentViewMode.value === 'favorites') {
      let paths: string[] = [];
      if (favTab.value === 'songs') {
        paths = [...favoriteSongPaths.value];
      } else if (favTab.value === 'artists') {
        paths = favDetailFilter.value?.type === 'artist'
          ? favoriteSongPaths.value.filter(path => songHasArtist(songLookup.value.get(path)!, favDetailFilter.value!.name))
          : [];
      } else if (favTab.value === 'albums') {
        paths = favDetailFilter.value?.type === 'album'
          ? favoriteSongPaths.value.filter(path => matchesAlbumKey(songLookup.value.get(path)!, favDetailFilter.value!.name))
          : [];
      } else {
        paths = [...favoriteSongPaths.value];
      }

      return sortSongPathsByLocalMode(paths, localSortMode.value);
    }

    if (currentViewMode.value === 'playlist') {
      const playlist = playlists.value.find(item => item.id === filterCondition.value);
      if (!playlist) {
        return [];
      }

      const paths = playlist.songPaths.filter(path => songLookup.value.has(path));

      if (playlistSortMode.value === 'title') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
            songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
            'zh-CN',
          ),
        );
      } else if (playlistSortMode.value === 'name') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.name || '').localeCompare(songLookup.value.get(right)?.name || '', 'zh-CN'),
        );
      } else if (playlistSortMode.value === 'artist') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
        );
      } else if (playlistSortMode.value === 'added_at') {
        paths.sort((left, right) =>
          (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
        );
      } else if (playlistSortMode.value === 'added_at_asc') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
        );
      }

      return paths;
    }

    return canonicalSongPaths.value.filter(path => {
      const song = songLookup.value.get(path);
      if (!song) {
        return false;
      }

      return songHasArtist(song, filterCondition.value) || matchesAlbumKey(song, filterCondition.value);
    });
  });

  const currentViewSongs = computed(() =>
    materializeSongPaths(currentViewSongPaths.value),
  );

  const currentViewSongCount = computed(() => currentViewSongPaths.value.length);

  return {
    currentViewSongPaths,
    currentViewSongCount,
    currentViewSongs,
  };
}
