import { storeToRefs } from 'pinia';
import type { Song } from '../types';
import { playbackApi } from '../services/tauri/playbackApi';
import { usePlaybackStore } from '../features/playback/store';
import { useUiStore } from '../shared/stores/ui';
import { useCoverCache } from './useCoverCache';

interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
}

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

interface CreatePlayerPlaybackDeps {
  getDisplaySongList: () => Song[];
  addToHistory: (song: Song) => void | Promise<void>;
  loadLyrics: () => void | Promise<void>;
  handleAutoNext: () => void;
  onBeforePlay?: (song: Song, options: PlaySongOptions) => void;
}

let progressFrameId: number | null = null;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let playRequestId = 0;
let latestSeekRequestId = 0;
let playbackAnchorTime = 0;
let playbackStartOffset = 0;
let sessionStartTime: number | null = null;
let accumulatedTime = 0;
let isSeeking = false;

export const createPlayerPlayback = ({
  getDisplaySongList,
  addToHistory,
  loadLyrics,
  handleAutoNext,
  onBeforePlay,
}: CreatePlayerPlaybackDeps) => {
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const { loadCover, loadCoverPath, loadFullCover, peekCoverUrl, peekCoverPath, getFullCoverUrl } = useCoverCache();
  const {
    currentCover,
    currentCoverFull,
    currentSong,
    currentTime,
    isPlaying,
    isSongLoaded,
    playQueue,
  } = storeToRefs(playbackStore);
  const { showPlayerDetail } = storeToRefs(uiStore);

  const stopPlaybackRuntime = () => {
    if (progressFrameId !== null) {
      cancelAnimationFrame(progressFrameId);
      progressFrameId = null;
    }
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const reanchorPlaybackClock = (time: number) => {
    playbackAnchorTime = performance.now();
    playbackStartOffset = time;
    currentTime.value = time;
  };

  const startPlaybackRuntime = () => {
    stopPlaybackRuntime();
    reanchorPlaybackClock(currentTime.value);

    const update = () => {
      if (!currentSong.value || !isPlaying.value) return;

      const now = performance.now();
      const delta = (now - playbackAnchorTime) / 1000.0;
      currentTime.value = playbackStartOffset + delta;

      if (currentTime.value >= currentSong.value.duration) {
        handleAutoNext();
        return;
      }

      progressFrameId = requestAnimationFrame(update);
    };

    progressFrameId = requestAnimationFrame(update);
    syncIntervalId = setInterval(async () => {
      if (!isPlaying.value || isSeeking) return;

      try {
        const realTime = await playbackApi.getPlaybackProgress();
        if (Math.abs(realTime - currentTime.value) > 0.05) {
          reanchorPlaybackClock(realTime);
        }
      } catch {}
    }, 1000);
  };

  const flushPlaySession = () => {
    const song = currentSong.value;
    if (!song) return;

    let currentSession = 0;
    if (isPlaying.value && sessionStartTime) {
      currentSession = (Date.now() - sessionStartTime) / 1000;
    }

    const totalDuration = accumulatedTime + currentSession;
    if (totalDuration >= 10) {
      playbackApi.recordPlay(song.path, Math.floor(totalDuration))
        .catch(error => console.warn('record_play failed:', error));
    }

    accumulatedTime = 0;
    sessionStartTime = null;
  };

  const playSong = async (song: Song, options: PlaySongOptions = {}) => {
    const requestId = ++playRequestId;

    flushPlaySession();
    onBeforePlay?.(song, options);

    const preserveQueue = options.preserveQueue ?? false;
    currentSong.value = song;

    if (!preserveQueue) {
      const displaySongList = getDisplaySongList();
      if (displaySongList.some(item => item.path === song.path)) {
        playQueue.value = displaySongList;
      } else if (!playQueue.value.some(item => item.path === song.path)) {
        if (playQueue.value.length === 0) {
          playQueue.value = [song];
        } else {
          playQueue.value = [...playQueue.value, song];
        }
      }
    }

    isPlaying.value = true;
    isSongLoaded.value = false;
    const cachedCover = peekCoverUrl(song.path);
    const cachedCoverPath = peekCoverPath(song.path);
    const cachedFullCover = getFullCoverUrl(song.path);
    currentCover.value = cachedCover;
    currentCoverFull.value = cachedFullCover || '';
    if (showPlayerDetail.value && !cachedFullCover) {
      void loadFullCover(song.path).catch(() => {});
    }
    stopPlaybackRuntime();
    reanchorPlaybackClock(0);
    accumulatedTime = 0;
    sessionStartTime = null;

    addToHistory(song);

    try {
      await playbackApi.playAudio({
        path: song.path,
        title: song.name,
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        cover: cachedCoverPath,
        duration: Math.floor(song.duration),
      });
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      isSongLoaded.value = true;
      sessionStartTime = Date.now();
      loadLyrics();
      startPlaybackRuntime();

      void Promise.all([loadCover(song.path), loadCoverPath(song.path)])
        .then(async ([cover, coverPath]) => {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return;
          }

          const normalizedCover = cover || '';
          const normalizedCoverPath = coverPath || '';
          currentCover.value = normalizedCover;
          if (!currentCoverFull.value) {
            currentCoverFull.value = normalizedCover;
          }

          await playbackApi.updatePlaybackMetadata({
            title: song.name,
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Unknown Album',
            cover: normalizedCoverPath,
            duration: Math.floor(song.duration),
            isPlaying: isPlaying.value,
          }).catch(() => {});
        })
        .catch(() => {});
    } catch {
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      isPlaying.value = false;
      isSongLoaded.value = false;
      sessionStartTime = null;
      stopPlaybackRuntime();
    }
  };

  const pauseSong = async () => {
    if (isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
    }

    isPlaying.value = false;
    await playbackApi.pauseAudio();
    stopPlaybackRuntime();
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    if (isPlaying.value) {
      if (sessionStartTime) {
        accumulatedTime += (Date.now() - sessionStartTime) / 1000;
        sessionStartTime = null;
      }

      await playbackApi.pauseAudio();
      isPlaying.value = false;
      stopPlaybackRuntime();
      return;
    }

    if (!isSongLoaded.value) {
      await playSong(currentSong.value);
    } else {
      await playbackApi.resumeAudio();
      sessionStartTime = Date.now();
    }

    isPlaying.value = true;
    startPlaybackRuntime();
  };

  const seekTo = async (newTime: number) => {
    if (!currentSong.value) return;

    if (isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = Date.now();
    }

    isSeeking = true;
    stopPlaybackRuntime();
    const targetTime = Math.max(0, Math.min(newTime, currentSong.value.duration));
    const requestId = ++latestSeekRequestId;
    reanchorPlaybackClock(targetTime);

    try {
      await playbackApi.seekAudio({
        time: targetTime,
        isPlaying: isPlaying.value,
        requestId,
      });
      reanchorPlaybackClock(targetTime);
      if (isPlaying.value) {
        startPlaybackRuntime();
      }
    } catch (error) {
      isSeeking = false;
      if (isPlaying.value) {
        startPlaybackRuntime();
      }
      throw error;
    }
  };

  const playAt = async (time: number) => {
    await seekTo(time);
    if (!isPlaying.value) {
      setTimeout(async () => {
        if (!isPlaying.value) {
          await togglePlay();
        }
      }, 150);
    }
  };

  const handleSeek = async (event: MouseEvent) => {
    if (!currentSong.value) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    await seekTo(progress * currentSong.value.duration);
  };

  const stepSeek = async (step: number) => {
    if (!currentSong.value) return;
    await seekTo(currentTime.value + step);
  };

  const handleSeekCompleted = (payload: SeekCompletedPayload) => {
    if (payload.request_id !== latestSeekRequestId) return;

    isSeeking = false;
    reanchorPlaybackClock(payload.time);
  };

  const dispose = () => {
    stopPlaybackRuntime();
  };

  return {
    flushPlaySession,
    playSong,
    pauseSong,
    togglePlay,
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
    handleSeekCompleted,
    stopPlaybackRuntime,
    dispose,
  };
};
