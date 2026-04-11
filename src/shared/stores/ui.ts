import { ref } from 'vue';
import { defineStore } from 'pinia';

export const defaultDominantColors = ['transparent', 'transparent', 'transparent', 'transparent'];

export const useUiStore = defineStore('ui', () => {
  const showPlaylist = ref(false);
  const showMiniPlaylist = ref(false);
  const showPlayerDetail = ref(false);
  const showQueue = ref(false);
  const isMiniMode = ref(false);
  const showVolumePopover = ref(false);
  const showAddToPlaylistModal = ref(false);
  const playlistAddTargetSongs = ref<string[]>([]);
  const dominantColors = ref<string[]>([...defaultDominantColors]);

  return {
    showPlaylist,
    showMiniPlaylist,
    showPlayerDetail,
    showQueue,
    isMiniMode,
    showVolumePopover,
    showAddToPlaylistModal,
    playlistAddTargetSongs,
    dominantColors,
  };
});
