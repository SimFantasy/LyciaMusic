import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryCatalogSelectors } from './useLibraryCatalogSelectors';
import { useLibraryCollectionSelectors } from './useLibraryCollectionSelectors';
import { useLibraryCurrentViewSongs } from './useLibraryCurrentViewSongs';
import { useLibraryFolderSelectors } from './useLibraryFolderSelectors';
import type { Song } from '../../types';

export type { AlbumListItem, ArtistListItem } from './playerLibraryViewShared';

export function usePlayerLibraryView() {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();

  const {
    activeRootPath,
    currentAlbumFilter,
    currentArtistFilter,
    currentFolderFilter,
    currentViewMode,
    favDetailFilter,
    favTab,
    filterCondition,
    localMusicTab,
    searchQuery,
  } = storeToRefs(navigationStore);
  const {
    libraryHierarchy,
    libraryFolders,
    canonicalSongs,
    sourceSongs,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs, playlistSortMode } = storeToRefs(collectionsStore);

  const isLocalMusic = computed(() =>
    currentViewMode.value === 'all' ||
    currentViewMode.value === 'artist' ||
    currentViewMode.value === 'album',
  );

  const isFolderMode = computed(() => currentViewMode.value === 'folder');
  const songLookup = computed(() => {
    const lookup = new Map<string, Song>();

    canonicalSongs.value.forEach(song => {
      lookup.set(song.path, song);
    });
    sourceSongs.value.forEach(song => {
      if (!lookup.has(song.path)) {
        lookup.set(song.path, song);
      }
    });

    return lookup;
  });

  const catalogSelectors = useLibraryCatalogSelectors({
    canonicalSongs,
    searchQuery,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
  });

  const folderSelectors = useLibraryFolderSelectors({
    watchedFolders,
    sourceSongs,
    currentFolderFilter,
    folderSortMode,
    folderCustomOrder,
  });

  const collectionSelectors = useLibraryCollectionSelectors({
    canonicalSongs,
    favoritePaths,
    playlists,
    recentSongs,
    songLookup,
  });

  const { currentViewSongs } = useLibraryCurrentViewSongs({
    canonicalSongs,
    sourceSongs,
    playlists,
    recentSongs,
    songLookup,
    favoriteSongList: collectionSelectors.favoriteSongList,
    currentFolderSongs: folderSelectors.currentFolderSongs,
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
  });

  return {
    activeRootPath,
    albumList: catalogSelectors.albumList,
    artistList: catalogSelectors.artistList,
    canonicalSongs,
    currentFolderSongs: folderSelectors.currentFolderSongs,
    currentViewSongs,
    favAlbumList: collectionSelectors.favAlbumList,
    favArtistList: collectionSelectors.favArtistList,
    favoriteSongList: collectionSelectors.favoriteSongList,
    filteredAlbumList: catalogSelectors.filteredAlbumList,
    filteredArtistList: catalogSelectors.filteredArtistList,
    folderList: folderSelectors.folderList,
    isFolderMode,
    isLocalMusic,
    libraryFolders,
    libraryHierarchy,
    recentAlbumList: collectionSelectors.recentAlbumList,
    recentPlaylistList: collectionSelectors.recentPlaylistList,
    searchQuery,
    sourceSongs,
    // Compatibility aliases for existing callers.
    displaySongList: currentViewSongs,
    folderTree: libraryHierarchy,
    librarySongs: canonicalSongs,
    songList: sourceSongs,
  };
}
