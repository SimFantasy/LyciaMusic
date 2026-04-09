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

const sortByAddedAtDesc = (songs: Song[]) => {
  songs.sort((left, right) => (right.added_at || 0) - (left.added_at || 0));
};

const sortByAddedAtAsc = (songs: Song[]) => {
  songs.sort((left, right) => (left.added_at || 0) - (right.added_at || 0));
};

const sortByFileModifiedAtDesc = (songs: Song[]) => {
  songs.sort((left, right) => (right.file_modified_at || 0) - (left.file_modified_at || 0));
};

const sortByFileModifiedAtAsc = (songs: Song[]) => {
  songs.sort((left, right) => (left.file_modified_at || 0) - (right.file_modified_at || 0));
};

interface UseLibraryCurrentViewSongsOptions {
  canonicalSongs: Ref<Song[]>;
  sourceSongs: Ref<Song[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
  favoriteSongList: ComputedRef<Song[]>;
  currentFolderSongs: ComputedRef<Song[]>;
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

const sortSongsByLocalMode = (songs: Song[], mode: LocalSortMode) => {
  if (mode === 'title') {
    songs.sort((left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'));
  } else if (mode === 'artist') {
    songs.sort((left, right) => (left.artist || '').localeCompare(right.artist || '', 'zh-CN'));
  } else if (mode === 'added_at') {
    sortByAddedAtDesc(songs);
  } else if (mode === 'added_at_asc') {
    sortByAddedAtAsc(songs);
  } else if (mode === 'file_modified_at') {
    sortByFileModifiedAtDesc(songs);
  } else if (mode === 'file_modified_at_asc') {
    sortByFileModifiedAtAsc(songs);
  }
};

export function useLibraryCurrentViewSongs({
  canonicalSongs,
  sourceSongs,
  playlists,
  recentSongs,
  songLookup,
  favoriteSongList,
  currentFolderSongs,
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
  const resolveRecentSongs = () =>
    recentSongs.value
      .map(item => songLookup.value.get(item.path))
      .filter((song): song is Song => !!song);

  const currentViewSongs = computed(() => {
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase();

      if (currentViewMode.value === 'favorites') {
        return favoriteSongList.value.filter(song =>
          song.name.toLowerCase().includes(query) ||
          getSongArtistSearchText(song).includes(query),
        );
      }

      if (currentViewMode.value === 'recent') {
        return resolveRecentSongs().filter(song => song.name.toLowerCase().includes(query));
      }

      if (currentViewMode.value === 'all') {
        return sortItemsByAlphabetIndex(
          canonicalSongs.value.filter(song =>
            song.name.toLowerCase().includes(query) ||
            getSongArtistSearchText(song).includes(query) ||
            song.album.toLowerCase().includes(query),
          ),
          getSongTitleLabel,
        );
      }

      if (currentViewMode.value === 'folder') {
        return sortItemsByAlphabetIndex(
          sourceSongs.value.filter(song =>
            song.name.toLowerCase().includes(query) ||
            getSongArtistSearchText(song).includes(query) ||
            song.album.toLowerCase().includes(query),
          ),
          getSongTitleLabel,
        );
      }

      return canonicalSongs.value.filter(song =>
        song.name.toLowerCase().includes(query) ||
        getSongArtistSearchText(song).includes(query) ||
        song.album.toLowerCase().includes(query),
      );
    }

    if (currentViewMode.value === 'all') {
      let base = [...canonicalSongs.value];
      if (localMusicTab.value === 'artist' && currentArtistFilter.value) {
        base = base.filter(song => songHasArtist(song, currentArtistFilter.value));
      } else if (localMusicTab.value === 'album' && currentAlbumFilter.value) {
        base = base.filter(song => matchesAlbumKey(song, currentAlbumFilter.value));
      }

      if (localSortMode.value === 'title') {
        base = sortItemsByAlphabetIndex(base, getSongTitleLabel);
      } else if (localSortMode.value === 'artist') {
        base.sort((left, right) => (left.artist || '').localeCompare(right.artist || '', 'zh-CN'));
      } else if (localSortMode.value === 'added_at') {
        sortByAddedAtDesc(base);
      } else if (localSortMode.value === 'added_at_asc') {
        sortByAddedAtAsc(base);
      } else if (localSortMode.value === 'file_modified_at') {
        sortByFileModifiedAtDesc(base);
      } else if (localSortMode.value === 'file_modified_at_asc') {
        sortByFileModifiedAtAsc(base);
      } else if (localSortMode.value === 'custom') {
        const orderMap = new Map(localCustomOrder.value.map((path, index) => [path, index]));
        base.sort((left, right) => {
          const leftIndex = orderMap.has(left.path) ? orderMap.get(left.path)! : Number.MAX_SAFE_INTEGER;
          const rightIndex = orderMap.has(right.path) ? orderMap.get(right.path)! : Number.MAX_SAFE_INTEGER;
          return leftIndex - rightIndex;
        });
      } else {
        base = sortItemsByAlphabetIndex(base, getSongTitleLabel);
      }

      return base;
    }

    if (currentViewMode.value === 'folder') {
      return currentFolderSongs.value;
    }

    if (currentViewMode.value === 'recent') {
      const songs = [...resolveRecentSongs()];
      sortSongsByLocalMode(songs, localSortMode.value);
      return songs;
    }

    if (currentViewMode.value === 'favorites') {
      let songs: Song[] = [];
      if (favTab.value === 'songs') {
        songs = [...favoriteSongList.value];
      } else if (favTab.value === 'artists') {
        songs = favDetailFilter.value?.type === 'artist'
          ? favoriteSongList.value.filter(song => songHasArtist(song, favDetailFilter.value!.name))
          : [];
      } else if (favTab.value === 'albums') {
        songs = favDetailFilter.value?.type === 'album'
          ? favoriteSongList.value.filter(song => matchesAlbumKey(song, favDetailFilter.value!.name))
          : [];
      } else {
        songs = [...favoriteSongList.value];
      }

      sortSongsByLocalMode(songs, localSortMode.value);
      return songs;
    }

    if (currentViewMode.value === 'playlist') {
      const playlist = playlists.value.find(item => item.id === filterCondition.value);
      if (!playlist) {
        return [];
      }

      const songMap = new Map<string, Song>();
      canonicalSongs.value.forEach(song => songMap.set(song.path, song));
      sourceSongs.value.forEach(song => {
        if (!songMap.has(song.path)) {
          songMap.set(song.path, song);
        }
      });

      const songs = playlist.songPaths
        .map(path => songMap.get(path))
        .filter((song): song is Song => !!song);

      if (playlistSortMode.value === 'title') {
        songs.sort((left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'));
      } else if (playlistSortMode.value === 'name') {
        songs.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      } else if (playlistSortMode.value === 'artist') {
        songs.sort((left, right) => (left.artist || '').localeCompare(right.artist || '', 'zh-CN'));
      } else if (playlistSortMode.value === 'added_at') {
        songs.sort((left, right) => (right.added_at || 0) - (left.added_at || 0));
      } else if (playlistSortMode.value === 'added_at_asc') {
        songs.sort((left, right) => (left.added_at || 0) - (right.added_at || 0));
      }

      return songs;
    }

    return canonicalSongs.value.filter(song =>
      songHasArtist(song, filterCondition.value) ||
      matchesAlbumKey(song, filterCondition.value),
    );
  });

  return {
    currentViewSongs,
  };
}
