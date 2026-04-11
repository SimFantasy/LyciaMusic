import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import type { Song } from '../../types';

export const usePlaybackStore = defineStore('playback', () => {
  const isPlaying = ref(false);
  const volume = ref(100);
  const currentTime = ref(0);
  const playMode = ref(0);
  const isSongLoaded = ref(false);
  const playQueue = shallowRef<Song[]>([]);
  const tempQueue = shallowRef<Song[]>([]);
  const currentSong = ref<Song | null>(null);
  const currentCover = ref('');
  const currentCoverFull = ref('');

  const resetPlaybackState = () => {
    isPlaying.value = false;
    currentTime.value = 0;
    isSongLoaded.value = false;
    playQueue.value = [];
    tempQueue.value = [];
    currentSong.value = null;
    currentCover.value = '';
    currentCoverFull.value = '';
  };

  return {
    isPlaying,
    volume,
    currentTime,
    playMode,
    isSongLoaded,
    playQueue,
    tempQueue,
    currentSong,
    currentCover,
    currentCoverFull,
    resetPlaybackState,
  };
});
