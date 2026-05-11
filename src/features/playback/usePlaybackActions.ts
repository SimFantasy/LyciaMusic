import type { Ref } from 'vue';

import type { Song } from '../../types';

interface PlayerPlaybackApi {
  playSong: (song: Song, options?: {
    updateShuffleHistory?: boolean;
    clearShuffleFuture?: boolean;
    preserveQueue?: boolean;
    insertAfterCurrent?: boolean;
  }) => Promise<unknown>;
  pauseSong: () => Promise<unknown>;
  togglePlay: () => Promise<unknown>;
  seekTo: (newTime: number) => Promise<unknown>;
  playAt: (time: number) => Promise<unknown>;
  handleSeek: (event: MouseEvent) => Promise<unknown>;
  stepSeek: (step: number) => Promise<unknown>;
}

interface PlayerQueueApi {
  toggleMode: () => void;
  playNext: (song: Song) => void;
  nextSong: () => void;
  prevSong: () => void;
  clearQueue: () => Promise<unknown>;
  removeSongFromQueue: (song: Song) => void;
  addSongToQueue: (song: Song) => void;
  addSongsToQueue: (songs: Song[]) => void;
}

interface PlayerUiShellApi {
  handleVolume: (event: Event) => Promise<unknown>;
  handleVolumeWheel: (event: WheelEvent) => Promise<unknown>;
  toggleMute: () => Promise<unknown>;
  togglePlaylist: () => void;
  toggleMiniPlaylist: () => void;
  closeMiniPlaylist: () => void;
  handleScan: () => Promise<unknown>;
  removeSongFromList: (song: Song) => Promise<unknown>;
}

interface UsePlaybackActionsOptions {
  currentSong: Ref<Song | null>;
  playMode: Ref<number>;
  getPlayerPlayback: () => PlayerPlaybackApi;
  getPlayerQueue: () => PlayerQueueApi;
  playerUiShell: PlayerUiShellApi;
}

export function usePlaybackActions({
  currentSong,
  playMode,
  getPlayerPlayback,
  getPlayerQueue,
  playerUiShell,
}: UsePlaybackActionsOptions) {
  const handleAutoNext = () => {
    if (playMode.value === 1 && currentSong.value) {
      void getPlayerPlayback().playSong(currentSong.value);
      return;
    }

    getPlayerQueue().nextSong();
  };

  const handleVolume = (event: Event) => playerUiShell.handleVolume(event);
  const handleVolumeWheel = (event: WheelEvent) => playerUiShell.handleVolumeWheel(event);
  const toggleMute = () => playerUiShell.toggleMute();
  const toggleMode = () => getPlayerQueue().toggleMode();
  const togglePlaylist = () => playerUiShell.togglePlaylist();
  const toggleMiniPlaylist = () => playerUiShell.toggleMiniPlaylist();
  const closeMiniPlaylist = () => playerUiShell.closeMiniPlaylist();
  const handleScan = () => playerUiShell.handleScan();
  const playNext = (song: Song) => getPlayerQueue().playNext(song);
  const removeSongFromList = (song: Song) => playerUiShell.removeSongFromList(song);
  const playSong = (song: Song, options?: {
    updateShuffleHistory?: boolean;
    clearShuffleFuture?: boolean;
    preserveQueue?: boolean;
    insertAfterCurrent?: boolean;
  }) =>
    getPlayerPlayback().playSong(song, options);
  const pauseSong = () => getPlayerPlayback().pauseSong();
  const togglePlay = () => getPlayerPlayback().togglePlay();
  const nextSong = () => getPlayerQueue().nextSong();
  const prevSong = () => getPlayerQueue().prevSong();
  const clearQueue = () => getPlayerQueue().clearQueue();
  const removeSongFromQueue = (song: Song) => getPlayerQueue().removeSongFromQueue(song);
  const addSongToQueue = (song: Song) => getPlayerQueue().addSongToQueue(song);
  const addSongsToQueue = (songs: Song[]) => getPlayerQueue().addSongsToQueue(songs);
  const seekTo = (newTime: number) => getPlayerPlayback().seekTo(newTime);
  const playAt = (time: number) => getPlayerPlayback().playAt(time);
  const handleSeek = (event: MouseEvent) => getPlayerPlayback().handleSeek(event);
  const stepSeek = (step: number) => getPlayerPlayback().stepSeek(step);

  return {
    handleAutoNext,
    handleVolume,
    handleVolumeWheel,
    toggleMute,
    toggleMode,
    togglePlaylist,
    toggleMiniPlaylist,
    closeMiniPlaylist,
    handleScan,
    playNext,
    removeSongFromList,
    playSong,
    pauseSong,
    togglePlay,
    nextSong,
    prevSong,
    clearQueue,
    removeSongFromQueue,
    addSongToQueue,
    addSongsToQueue,
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
  };
}
