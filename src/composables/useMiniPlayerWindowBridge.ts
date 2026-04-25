import { LogicalPosition } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, watch } from 'vue';

import { useLyrics } from './lyrics';
import { usePlayer } from './player';
import {
  MINI_PLAYER_ACTION_EVENT,
  MINI_PLAYER_BOUNDS_EVENT,
  MINI_PLAYER_BOUNDS_KEY,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_EVENT,
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_LABEL,
  MINI_PLAYER_WINDOW_WIDTH,
  type MiniPlayerAction,
  type MiniPlayerStatePayload,
  type MiniPlayerWindowBounds,
} from '../features/miniPlayer/shared';

let miniPlayerWindowPromise: Promise<WebviewWindow> | null = null;

function readMiniPlayerBounds(): MiniPlayerWindowBounds | null {
  if (typeof localStorage === 'undefined') return null;

  const stored = localStorage.getItem(MINI_PLAYER_BOUNDS_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<MiniPlayerWindowBounds>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(parsed.x as number),
      y: Math.round(parsed.y as number),
    };
  } catch {
    return null;
  }
}

function writeMiniPlayerBounds(bounds: MiniPlayerWindowBounds) {
  if (typeof localStorage === 'undefined') return;

  localStorage.setItem(MINI_PLAYER_BOUNDS_KEY, JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  }));
}

async function getMiniPlayerWindow() {
  return WebviewWindow.getByLabel(MINI_PLAYER_WINDOW_LABEL);
}

async function ensureMiniPlayerWindow() {
  const existing = await getMiniPlayerWindow();
  if (existing) return existing;

  if (!miniPlayerWindowPromise) {
    const bounds = readMiniPlayerBounds();
    const windowInstance = new WebviewWindow(MINI_PLAYER_WINDOW_LABEL, {
      url: '/',
      title: 'Lycia Mini Player',
      width: MINI_PLAYER_WINDOW_WIDTH,
      height: MINI_PLAYER_WINDOW_BASE_HEIGHT,
      minWidth: MINI_PLAYER_WINDOW_WIDTH,
      minHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
      maxWidth: MINI_PLAYER_WINDOW_WIDTH,
      maxHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      shadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      center: !bounds,
    });

    miniPlayerWindowPromise = new Promise<WebviewWindow>((resolve, reject) => {
      let settled = false;

      void windowInstance.once('tauri://created', async () => {
        if (settled) return;

        try {
          if (bounds) {
            await windowInstance.setPosition(new LogicalPosition(bounds.x, bounds.y));
          }

          settled = true;
          miniPlayerWindowPromise = null;
          resolve(windowInstance);
        } catch (error) {
          settled = true;
          miniPlayerWindowPromise = null;
          reject(error);
        }
      });

      void windowInstance.once('tauri://error', (event) => {
        if (settled) return;
        settled = true;
        miniPlayerWindowPromise = null;
        reject(event.payload);
      });
    });
  }

  return miniPlayerWindowPromise;
}

export function useMiniPlayerWindowBridge() {
  const mainWindow = getCurrentWindow();
  const {
    currentSong,
    isPlaying,
    volume,
    playQueue,
    songList,
    togglePlay,
    prevSong,
    nextSong,
    handleVolume,
    toggleMute,
    playSong,
    isMiniMode,
  } = usePlayer();
  const { currentLyricLine } = useLyrics();

  let isMainWindowClosing = false;
  const unlisteners: Array<() => void> = [];

  const createStatePayload = (): MiniPlayerStatePayload => ({
    currentSong: currentSong.value,
    isPlaying: isPlaying.value,
    volume: volume.value,
    queue: playQueue.value.length > 0 ? playQueue.value : songList.value,
    lyricText: currentLyricLine.value?.text ?? '',
  });

  const emitStateToMiniPlayer = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    await emitTo<MiniPlayerStatePayload>(
      MINI_PLAYER_WINDOW_LABEL,
      MINI_PLAYER_STATE_EVENT,
      createStatePayload(),
    );
  };

  const openMiniPlayerWindow = async () => {
    const targetWindow = await ensureMiniPlayerWindow();
    await targetWindow.setAlwaysOnTop(true);
    await emitStateToMiniPlayer();
    await targetWindow.show();
    await mainWindow.hide();
  };

  const destroyMiniPlayerWindow = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy mini player window:', error);
    } finally {
      miniPlayerWindowPromise = null;
    }
  };

  const handleAction = async (action: MiniPlayerAction) => {
    switch (action.type) {
      case 'toggle-play':
        await togglePlay();
        break;
      case 'prev-song':
        prevSong();
        break;
      case 'next-song':
        nextSong();
        break;
      case 'set-volume':
        await handleVolume({ target: { value: String(action.volume) } } as unknown as Event);
        break;
      case 'toggle-mute':
        await toggleMute();
        break;
      case 'play-song':
        await playSong(action.song);
        break;
      case 'restore-main':
        isMiniMode.value = false;
        await mainWindow.unminimize();
        await mainWindow.show();
        await mainWindow.setFocus();
        break;
      case 'close':
        isMiniMode.value = false;
        break;
      default:
        break;
    }
  };

  onMounted(async () => {
    unlisteners.push(await mainWindow.onCloseRequested(async (event) => {
      if (isMainWindowClosing) return;

      isMainWindowClosing = true;
      event.preventDefault();
      await destroyMiniPlayerWindow();
      await mainWindow.close();
    }));

    unlisteners.push(await listen(MINI_PLAYER_REQUEST_STATE_EVENT, () => {
      void emitStateToMiniPlayer();
    }));

    unlisteners.push(await listen<MiniPlayerAction>(MINI_PLAYER_ACTION_EVENT, (event) => {
      void handleAction(event.payload);
    }));

    unlisteners.push(await listen<MiniPlayerWindowBounds>(MINI_PLAYER_BOUNDS_EVENT, (event) => {
      writeMiniPlayerBounds(event.payload);
    }));
  });

  onUnmounted(() => {
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(isMiniMode, async (visible) => {
    if (visible) {
      await openMiniPlayerWindow();
      return;
    }

    await destroyMiniPlayerWindow();
  });

  watch(
    [
      currentSong,
      isPlaying,
      volume,
      playQueue,
      songList,
      () => currentLyricLine.value?.text,
    ],
    () => {
      if (!isMiniMode.value) return;
      void emitStateToMiniPlayer();
    },
    { deep: true },
  );
}
