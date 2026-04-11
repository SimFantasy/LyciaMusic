import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onMounted, onScopeDispose, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { extractDominantColors } from './colorExtraction';
import type { LibraryScanProgress, Song } from '../types';
import {
  playerStorage,
  playerStorageKeys,
  type AlbumSortMode,
  type ArtistSortMode,
  type FolderSortMode,
  type LocalSortMode,
  type PlaylistSortMode,
} from '../services/storage/playerStorage';
import { playbackApi } from '../services/tauri/playbackApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { mergeAppSettings, useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import type { AppSettings } from '../types';

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

interface LibraryScanBatchPayload {
  songs: Song[];
  deleted_paths: string[];
  folder_path: string;
  folder_index: number;
  folder_total: number;
}

interface LibraryScanProgressPayload extends LibraryScanProgress {}

interface CreatePlayerLifecycleDeps {
  bootstrapLibrary: () => Promise<void>;
  togglePlay: () => void | Promise<void>;
  nextSong: () => void;
  prevSong: () => void;
  applyLibraryScanBatch: (payload: LibraryScanBatchPayload) => void;
  flushBufferedLibraryScanBatch: () => void;
  handleSeekCompleted: (payload: SeekCompletedPayload) => void;
  schedulePersistedState: () => void;
  flushPersistedState: () => void;
  restorePathBackedState: () => Promise<void>;
  restoreRecentHistory: () => Promise<void>;
  refreshStateSongReferences: () => void;
  disposePlayerPlayback: () => void;
  disposeLibraryRuntime: () => void;
  disposePlayerPersistence: () => void;
  disposeLibraryBatch: () => void;
  lastSongPathKey: string;
  legacyLastSongKey: string;
}

let lifecycleInitDone = false;
let dominantColorTaskId = 0;

interface SortSettingsRefs {
  artistSortMode: Ref<ArtistSortMode>;
  albumSortMode: Ref<AlbumSortMode>;
  artistCustomOrder: Ref<string[]>;
  albumCustomOrder: Ref<string[]>;
  folderSortMode: Ref<FolderSortMode>;
  folderCustomOrder: Ref<Record<string, string[]>>;
  localSortMode: Ref<LocalSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

const restoreOutputDevice = async () => {
  const storedOutputDevice = playerStorage.getString(playerStorageKeys.outputDevice);
  const storedOutputMode = playerStorage.getString(playerStorageKeys.outputDeviceMode);

  if ((storedOutputMode === 'manual' || (!storedOutputMode && storedOutputDevice)) && storedOutputDevice) {
    await playbackApi.setOutputDevice(storedOutputDevice).catch(error => {
      console.warn('Failed to restore output device:', error);
    });
    return;
  }

  await playbackApi.setOutputDevice(null).catch(error => {
    console.warn('Failed to restore default output device mode:', error);
  });
};

const restoreSortSettings = ({
  artistSortMode,
  albumSortMode,
  artistCustomOrder,
  albumCustomOrder,
  folderSortMode,
  folderCustomOrder,
  localSortMode,
  localCustomOrder,
  playlistSortMode,
}: SortSettingsRefs) => {
  const storedArtistSort = playerStorage.getString(playerStorageKeys.artistSortMode);
  if (storedArtistSort) {
    artistSortMode.value = storedArtistSort as ArtistSortMode;
  }

  const storedAlbumSort = playerStorage.getString(playerStorageKeys.albumSortMode);
  if (storedAlbumSort && ['count', 'name', 'artist', 'custom'].includes(storedAlbumSort)) {
    albumSortMode.value = storedAlbumSort as AlbumSortMode;
  }

  const storedArtistOrder = playerStorage.readStringArray(playerStorageKeys.artistCustomOrder);
  if (storedArtistOrder) {
    artistCustomOrder.value = storedArtistOrder;
  }

  const storedAlbumOrder = playerStorage.readStringArray(playerStorageKeys.albumCustomOrder);
  if (storedAlbumOrder) {
    albumCustomOrder.value = storedAlbumOrder;
  }

  const storedFolderSort = playerStorage.getString(playerStorageKeys.folderSortMode);
  if (storedFolderSort && ['title', 'name', 'artist', 'added_at', 'custom'].includes(storedFolderSort)) {
    folderSortMode.value = storedFolderSort as FolderSortMode;
  }

  const storedLocalSort = playerStorage.getString(playerStorageKeys.localSortMode);
  if (storedLocalSort && ['title', 'artist', 'added_at', 'added_at_asc', 'file_modified_at', 'file_modified_at_asc', 'custom'].includes(storedLocalSort)) {
    localSortMode.value = storedLocalSort as LocalSortMode;
  } else if (storedLocalSort === 'name') {
    localSortMode.value = 'title';
  } else if (storedLocalSort === 'default') {
    localSortMode.value = 'title';
  }

  const storedPlaylistSort = playerStorage.getString(playerStorageKeys.playlistSortMode);
  if (storedPlaylistSort && ['title', 'name', 'artist', 'added_at', 'custom'].includes(storedPlaylistSort)) {
    playlistSortMode.value = storedPlaylistSort as PlaylistSortMode;
  }

  const storedFolderOrder = playerStorage.readObject<Record<string, string[]>>(playerStorageKeys.folderCustomOrder);
  if (storedFolderOrder) {
    folderCustomOrder.value = storedFolderOrder;
  }

  const storedLocalOrder = playerStorage.readStringArray(playerStorageKeys.localCustomOrder);
  if (storedLocalOrder) {
    localCustomOrder.value = storedLocalOrder;
  }
};

const restoreAppSettings = (
  currentSettings: AppSettings,
  replaceSettings: (settings: AppSettings) => void,
) => {
  const storedSettings = playerStorage.readSettings();
  if (!storedSettings) return;

  try {
    const saved = storedSettings as Partial<typeof currentSettings>;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    type SavedThemeShape = Partial<typeof currentSettings.theme> & {
      enableDynamicBg?: boolean;
      dynamicBgType?: string;
      windowMaterial?: string;
    };

    const savedTheme =
      (saved.theme && typeof saved.theme === 'object' ? saved.theme : {}) as SavedThemeShape;
    const savedSidebar =
      (saved.sidebar && typeof saved.sidebar === 'object' ? saved.sidebar : {}) as Partial<typeof currentSettings.sidebar>;
    const savedCustomBackground =
      savedTheme.customBackground && typeof savedTheme.customBackground === 'object'
        ? savedTheme.customBackground
        : {} as Partial<typeof currentSettings.theme.customBackground>;

    let dynamicBgType = savedTheme.dynamicBgType;
    if (dynamicBgType === undefined && savedTheme.enableDynamicBg !== undefined) {
      dynamicBgType = savedTheme.enableDynamicBg ? 'flow' : 'none';
    }

    const savedWindowMaterial = typeof savedTheme.windowMaterial === 'string'
      && ['none', 'mica', 'acrylic'].includes(savedTheme.windowMaterial)
      ? savedTheme.windowMaterial as typeof currentSettings.theme.windowMaterial
      : currentSettings.theme.windowMaterial;

    replaceSettings(mergeAppSettings(currentSettings, {
      ...saved,
      theme: {
        ...savedTheme,
        windowMaterial: savedWindowMaterial,
        dynamicBgType:
          savedWindowMaterial !== 'none'
            ? 'none'
            : (dynamicBgType || currentSettings.theme.dynamicBgType),
        customBackground: savedCustomBackground,
      },
      sidebar: savedSidebar,
    }));
  } catch (error) {
    console.error('Failed to parse settings:', error);
  }
};

export const createPlayerLifecycle = ({
  bootstrapLibrary,
  togglePlay,
  nextSong,
  prevSong,
  applyLibraryScanBatch,
  flushBufferedLibraryScanBatch,
  handleSeekCompleted,
  schedulePersistedState,
  flushPersistedState,
  restorePathBackedState,
  restoreRecentHistory,
  refreshStateSongReferences,
  disposePlayerPlayback,
  disposeLibraryRuntime,
  disposePlayerPersistence,
  disposeLibraryBatch,
  lastSongPathKey,
  legacyLastSongKey,
}: CreatePlayerLifecycleDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const { settings } = storeToRefs(settingsStore);
  const {
    sourceSongPaths,
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
  const { favoritePaths, playlists, playlistSortMode } = storeToRefs(collectionsStore);
  const {
    currentCover,
    currentSongPath,
    currentTime,
    isPlaying,
    playMode,
    playQueuePaths,
    volume,
  } = storeToRefs(playbackStore);
  const { dominantColors } = storeToRefs(uiStore);
  const scheduleStatePersistence = () => {
    schedulePersistedState();
  };

  onMounted(async () => {
    await bootstrapLibrary();
  });

  const init = () => {
    if (lifecycleInitDone) {
      return;
    }
    lifecycleInitDone = true;

    const listenerRegistrations = [
      listen('player:play', () => {
        if (!isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:pause', () => {
        if (isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:next', () => {
        nextSong();
      }),
      listen('player:prev', () => {
        prevSong();
      }),
      listen<LibraryScanBatchPayload>('library-scan-batch', event => {
        applyLibraryScanBatch(event.payload);
      }),
      listen<LibraryScanProgressPayload>('library-scan-progress', event => {
        libraryStore.setLibraryScanProgress({
          ...event.payload,
          message: event.payload.message ?? null,
        });

        if (event.payload.failed) {
          libraryStore.setLastLibraryScanError(event.payload.message ?? 'Library scan failed');
        }

        if (event.payload.done) {
          flushBufferedLibraryScanBatch();
        }
      }),
      listen<SeekCompletedPayload>('seek_completed', event => {
        handleSeekCompleted(event.payload);
      }),
    ];

    watch(volume, value => {
      playerStorage.writeNumber(playerStorageKeys.volume, value);
    });

    watch(playMode, value => {
      playerStorage.writeNumber(playerStorageKeys.playMode, value);
    });

    watch(sourceSongPaths, scheduleStatePersistence);
    watch(playQueuePaths, scheduleStatePersistence);
    watch(watchedFolders, scheduleStatePersistence);
    watch(favoritePaths, scheduleStatePersistence, { deep: true });
    watch(playlists, scheduleStatePersistence, { deep: true });
    watch(settings, scheduleStatePersistence, { deep: true });
    watch(artistCustomOrder, scheduleStatePersistence, { deep: true });
    watch(albumCustomOrder, scheduleStatePersistence, { deep: true });
    watch(folderCustomOrder, scheduleStatePersistence, { deep: true });
    watch(localCustomOrder, scheduleStatePersistence, { deep: true });

    watch(artistSortMode, value => {
      playerStorage.setString(playerStorageKeys.artistSortMode, value);
    });
    watch(albumSortMode, value => {
      playerStorage.setString(playerStorageKeys.albumSortMode, value);
    });
    watch(folderSortMode, value => {
      playerStorage.setString(playerStorageKeys.folderSortMode, value);
    });
    watch(localSortMode, value => {
      playerStorage.setString(playerStorageKeys.localSortMode, value);
    });
    watch(playlistSortMode, value => {
      playerStorage.setString(playerStorageKeys.playlistSortMode, value);
    });

    watch(currentSongPath, path => {
      if (path) {
        playerStorage.setString(lastSongPathKey, path);
        playerStorage.remove(legacyLastSongKey);
        return;
      }

      playerStorage.remove(lastSongPathKey);
      playerStorage.remove(legacyLastSongKey);
    });

    // 封面切换时立即重提取主色
    watch(currentCover, async (nextCover) => {
      if (!nextCover) return;

      const taskId = ++dominantColorTaskId;
      let coverUrl = nextCover;
      if (!nextCover.startsWith('http') && !nextCover.startsWith('data:')) {
        coverUrl = convertFileSrc(nextCover);
      }

      const colors = await extractDominantColors(coverUrl, 4, {
        colorBoost: settings.value.theme.flowColorBoost,
        depth: settings.value.theme.flowDepth,
      });
      if (taskId !== dominantColorTaskId) return;
      dominantColors.value = colors;
    }, { immediate: true });

    // 流光参数微调时 debounce 延迟重提取主色，避免拖动滑块时频繁触发层切换闪烁
    let flowTweakTimer: ReturnType<typeof setTimeout> | null = null;
    watch([
      () => settings.value.theme.flowColorBoost,
      () => settings.value.theme.flowDepth,
    ], () => {
      if (flowTweakTimer) clearTimeout(flowTweakTimer);
      flowTweakTimer = setTimeout(async () => {
        const cover = currentCover.value;
        if (!cover) return;

        const taskId = ++dominantColorTaskId;
        let coverUrl = cover;
        if (!cover.startsWith('http') && !cover.startsWith('data:')) {
          coverUrl = convertFileSrc(cover);
        }

        const colors = await extractDominantColors(coverUrl, 4, {
          colorBoost: settings.value.theme.flowColorBoost,
          depth: settings.value.theme.flowDepth,
        });
        if (taskId !== dominantColorTaskId) return;
        dominantColors.value = colors;
      }, 500);
    });

    watch(isPlaying, playing => {
      if (!playing) {
        playerStorage.writeNumber(playerStorageKeys.lastTime, currentTime.value);
      }
    });

    const beforeUnloadHandler = () => {
      flushPersistedState();
      playerStorage.writeNumber(playerStorageKeys.lastTime, currentTime.value);
    };

    onMounted(async () => {
      const storedVolume = playerStorage.readNumber(playerStorageKeys.volume);
      if (storedVolume !== null) {
        volume.value = storedVolume;
        await playbackApi.setVolume(volume.value / 100);
      }

      const storedPlayMode = playerStorage.readNumber(playerStorageKeys.playMode);
      if (storedPlayMode !== null && [0, 1, 2].includes(storedPlayMode)) {
        playMode.value = storedPlayMode;
      }

      await restoreOutputDevice();

      libraryStore.setWatchedFolders(
        playerStorage.readStringArray(playerStorageKeys.watchedFolders) ?? [],
      );

      collectionsStore.setFavoritePaths(
        playerStorage.readStringArray(playerStorageKeys.favorites) ?? [],
      );

      collectionsStore.setPlaylists(playerStorage.readPlaylists());

      restoreSortSettings({
        artistSortMode,
        albumSortMode,
        artistCustomOrder,
        albumCustomOrder,
        folderSortMode,
        folderCustomOrder,
        localSortMode,
        localCustomOrder,
        playlistSortMode,
      });
      restoreAppSettings(settings.value, settingsStore.replaceSettings);

      await restorePathBackedState();
      await restoreRecentHistory();
      refreshStateSongReferences();

      const storedLastTime = playerStorage.readNumber(playerStorageKeys.lastTime);
      if (storedLastTime !== null) {
        currentTime.value = storedLastTime;
      }

      window.addEventListener('beforeunload', beforeUnloadHandler);
    });

    onScopeDispose(() => {
      void Promise.all(listenerRegistrations).then(unlisteners => {
        unlisteners.forEach(unlisten => unlisten());
      });
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      disposePlayerPlayback();
      disposeLibraryRuntime();
      disposePlayerPersistence();
      disposeLibraryBatch();
    });
  };

  return {
    init,
  };
};
