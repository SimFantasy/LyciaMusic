import { computed } from 'vue';

import { usePlayer } from './player';
import { useAppThemeSync } from './useAppThemeSync';
import { useExternalPathBridge } from './useExternalPathBridge';
import { useAppShellTheme } from './useAppShellTheme';
import { useMiniModeWindow } from './useMiniModeWindow';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useHomeRouteSync } from './useHomeRouteSync';
import { usePlayerViewState } from './usePlayerViewState';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useRoute, useRouter } from 'vue-router';

export function useAppShell() {
  const {
    init,
    playQueue,
    isMiniMode,
    showPlayerDetail,
    showMiniPlaylist,
    showPlaylist,
    closeMiniPlaylist,
    showVolumePopover,
    handleExternalPaths,
    libraryScanProgress,
  } = usePlayer();
  const {
    showAddToPlaylistModal,
    playlistAddTargetSongs,
    closeAddToPlaylistDialog,
    addSelectedSongsToPlaylist,
  } = useAddToPlaylistDialog();

  const { hasWindowMaterial, isMicaWindowMaterial, syncWindowMaterial } = useAppThemeSync();
  const { mainBlurStyle, mainContainerClass } = useAppShellTheme({
    showPlayerDetail,
    hasWindowMaterial,
    isMicaWindowMaterial,
  });
  const { isExternalDragActive } = useExternalPathBridge({ handleExternalPaths });

  const route = useRoute();
  const router = useRouter();
  const { currentViewMode, filterCondition, currentFolderFilter, activeRootPath } = usePlayerViewState();
  const { folderTree, searchQuery } = usePlayerLibraryView();

  useHomeRouteSync({
    route,
    router,
    currentViewMode,
    filterCondition,
    currentFolderFilter,
    activeRootPath,
    folderTree,
    searchQuery,
  });

  useMiniModeWindow({
    isMiniMode,
    showMiniPlaylist,
    showVolumePopover,
    showPlaylist,
    closeMiniPlaylist,
    syncWindowMaterial,
  });
  useKeyboardShortcuts();

  init();

  const isFooterVisible = computed(() => playQueue.value.length > 0);
  const libraryScanPercent = computed(() => {
    if (!libraryScanProgress.value) return 0;
    if (libraryScanProgress.value.total <= 0) return 8;
    const percent = (libraryScanProgress.value.current / libraryScanProgress.value.total) * 100;
    return Math.min(100, Math.max(6, percent));
  });
  const libraryScanPhaseLabel = computed(() => {
    switch (libraryScanProgress.value?.phase) {
      case 'collecting':
        return '扫描文件';
      case 'parsing':
        return '解析元数据';
      case 'writing':
        return '写入音乐库';
      case 'complete':
        return '扫描完成';
      case 'error':
        return '扫描失败';
      default:
        return '扫描音乐库';
    }
  });
  const libraryScanFolderLabel = computed(() => {
    if (!libraryScanProgress.value || libraryScanProgress.value.folder_total <= 1) {
      return '';
    }

    return `文件夹 ${libraryScanProgress.value.folder_index}/${libraryScanProgress.value.folder_total}`;
  });

  const handleGlobalAdd = (playlistId: string) => {
    addSelectedSongsToPlaylist(playlistId);
  };

  return {
    isMiniMode,
    showPlayerDetail,
    isExternalDragActive,
    libraryScanProgress,
    libraryScanPhaseLabel,
    libraryScanFolderLabel,
    libraryScanPercent,
    isFooterVisible,
    mainContainerClass,
    mainBlurStyle,
    showAddToPlaylistModal,
    playlistAddTargetSongs,
    closeAddToPlaylistDialog,
    handleGlobalAdd,
  };
}
