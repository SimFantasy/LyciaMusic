import { emitTo, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { useLyrics } from './lyrics';
import { usePlayer } from './player';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import {
  createDesktopLyricsSongSnapshot,
  DESKTOP_LYRICS_ACTION_EVENT,
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_BOUNDS_KEY,
  DESKTOP_LYRICS_PLAYBACK_EVENT,
  DESKTOP_LYRICS_RESET_BOUNDS_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
  DESKTOP_LYRICS_REQUEST_STATE_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT,
  DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
  DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
  DESKTOP_LYRICS_WINDOW_LABEL,
  DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
  DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
  restoreDesktopLyricsBounds,
  type DesktopLyricsAction,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWorkArea,
  type DesktopLyricsWindowBounds,
} from '../features/desktopLyrics/shared';

let desktopLyricsWindowPromise: Promise<WebviewWindow> | null = null;
const DESKTOP_LYRICS_PLAYBACK_SYNC_INTERVAL_MS = 400;

function readDesktopLyricsBounds(): DesktopLyricsWindowBounds | null {
  if (typeof localStorage === 'undefined') return null;

  const stored = localStorage.getItem(DESKTOP_LYRICS_BOUNDS_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<DesktopLyricsWindowBounds>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(parsed.x as number),
      y: Math.round(parsed.y as number),
      width: Math.max(
        DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
        Math.round(
          Number.isFinite(parsed.width)
            ? (parsed.width as number)
            : DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
        ),
      ),
      height: Math.max(
        DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
        Math.round(
          Number.isFinite(parsed.height)
            ? (parsed.height as number)
            : DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
        ),
      ),
    };
  } catch {
    return null;
  }
}

function writeDesktopLyricsBounds(bounds: DesktopLyricsWindowBounds) {
  if (typeof localStorage === 'undefined') return;

  localStorage.setItem(DESKTOP_LYRICS_BOUNDS_KEY, JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }));
}

export function clearDesktopLyricsStoredBounds() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DESKTOP_LYRICS_BOUNDS_KEY);
}

async function resolveDesktopLyricsBounds() {
  const bounds = readDesktopLyricsBounds();
  if (!bounds) return null;

  try {
    const workAreas: DesktopLyricsWorkArea[] = (await availableMonitors()).map((monitor) => ({
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    }));

    if (workAreas.length === 0) {
      return bounds;
    }

    return restoreDesktopLyricsBounds(bounds, workAreas);
  } catch {
    return bounds;
  }
}

async function getDesktopLyricsWindow() {
  return WebviewWindow.getByLabel(DESKTOP_LYRICS_WINDOW_LABEL);
}

async function ensureDesktopLyricsWindow(alwaysOnTop: boolean) {
  const existing = await getDesktopLyricsWindow();
  if (existing) return existing;

  if (!desktopLyricsWindowPromise) {
    const bounds = await resolveDesktopLyricsBounds();
    const windowInstance = new WebviewWindow(DESKTOP_LYRICS_WINDOW_LABEL, {
      url: '/',
      title: 'Lycia Desktop Lyrics',
      width: DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
      height: DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
      minWidth: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
      minHeight: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      shadow: false,
      skipTaskbar: true,
      alwaysOnTop,
      focusable: true,
      center: !bounds,
    });

    desktopLyricsWindowPromise = new Promise<WebviewWindow>((resolve, reject) => {
      let settled = false;

      void windowInstance.once('tauri://created', async () => {
        if (settled) return;

        try {
          if (bounds) {
            await windowInstance.setSize(new PhysicalSize(bounds.width, bounds.height));
            await windowInstance.setPosition(new PhysicalPosition(bounds.x, bounds.y));
          }

          settled = true;
          desktopLyricsWindowPromise = null;
          resolve(windowInstance);
        } catch (error) {
          settled = true;
          desktopLyricsWindowPromise = null;
          reject(error);
        }
      });

      void windowInstance.once('tauri://error', (event) => {
        if (settled) return;
        settled = true;
        desktopLyricsWindowPromise = null;
        reject(event.payload);
      });
    });
  }

  return desktopLyricsWindowPromise;
}

export function useDesktopLyricsWindowBridge() {
  const mainWindow = getCurrentWindow();
  const {
    showDesktopLyrics,
    parsedLyrics,
    lyricsStatus,
    currentLyricLine,
    lyricsSettings,
    desktopLyricsSettings,
  } = useLyrics();
  const { togglePlay, prevSong, nextSong } = usePlayer();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const settingsStore = useSettingsStore();
  const { currentSong, currentTime, isPlaying } = storeToRefs(playbackStore);
  const { audioDelay } = storeToRefs(settingsStore);
  const { dominantColors } = storeToRefs(uiStore);

  let isMainWindowClosing = false;
  let syncIntervalId: ReturnType<typeof setInterval> | null = null;
  const unlisteners: Array<() => void> = [];

  const createStatePayload = (): DesktopLyricsStatePayload => ({
    song: createDesktopLyricsSongSnapshot(currentSong.value),
    parsedLyrics: JSON.parse(JSON.stringify(parsedLyrics.value)) as DesktopLyricsStatePayload['parsedLyrics'],
    lyricsStatus: lyricsStatus.value,
    fallbackText: currentLyricLine.value.text,
    playbackTime: currentTime.value,
    syncedAt: Date.now(),
    isPlaying: isPlaying.value,
    audioDelay: audioDelay.value,
    settings: {
      showTranslation: lyricsSettings.showTranslation,
      showRomaji: lyricsSettings.showRomaji,
      isAlwaysOnTop: desktopLyricsSettings.isAlwaysOnTop,
      alwaysShowShadowBackground: desktopLyricsSettings.alwaysShowShadowBackground,
      autoHideWhenFullscreen: desktopLyricsSettings.autoHideWhenFullscreen,
      isLocked: desktopLyricsSettings.isLocked,
      persistLock: desktopLyricsSettings.persistLock,
      colorScheme: desktopLyricsSettings.colorScheme,
      customPlayedColor: desktopLyricsSettings.customPlayedColor,
      customUnplayedColor: desktopLyricsSettings.customUnplayedColor,
      customRomajiColor: desktopLyricsSettings.customRomajiColor,
      customTranslationColor: desktopLyricsSettings.customTranslationColor,
      playerFontScale: desktopLyricsSettings.playerFontScale,
      playerLineGap: desktopLyricsSettings.playerLineGap,
      playerOffsetX: desktopLyricsSettings.playerOffsetX,
      playerOffsetY: desktopLyricsSettings.playerOffsetY,
      playerAlignment: desktopLyricsSettings.playerAlignment,
      playerFontPreset: desktopLyricsSettings.playerFontPreset,
    },
    themeColors: [...dominantColors.value],
  });

  const createPlaybackPayload = (): DesktopLyricsPlaybackPayload => ({
    playbackTime: currentTime.value,
    syncedAt: Date.now(),
    isPlaying: isPlaying.value,
    audioDelay: audioDelay.value,
  });

  const emitStateToDesktopLyrics = async () => {
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await emitTo<DesktopLyricsStatePayload>(
      DESKTOP_LYRICS_WINDOW_LABEL,
      DESKTOP_LYRICS_STATE_EVENT,
      createStatePayload(),
    );
  };

  const emitPlaybackToDesktopLyrics = async () => {
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await emitTo<DesktopLyricsPlaybackPayload>(
      DESKTOP_LYRICS_WINDOW_LABEL,
      DESKTOP_LYRICS_PLAYBACK_EVENT,
      createPlaybackPayload(),
    );
  };

  const revealDesktopLyricsSurface = async () => {
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await emitTo(DESKTOP_LYRICS_WINDOW_LABEL, DESKTOP_LYRICS_REVEAL_SURFACE_EVENT);
  };

  const syncWindowFlags = async () => {
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await targetWindow.setAlwaysOnTop(desktopLyricsSettings.isAlwaysOnTop);
  };

  const openDesktopLyricsWindow = async () => {
    const targetWindow = await ensureDesktopLyricsWindow(desktopLyricsSettings.isAlwaysOnTop);
    await syncWindowFlags();
    await emitStateToDesktopLyrics();
    await emitPlaybackToDesktopLyrics();
    await targetWindow.show();
    await revealDesktopLyricsSurface();
    startSyncLoop();
  };

  const stopSyncLoop = () => {
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const startSyncLoop = () => {
    stopSyncLoop();
    syncIntervalId = setInterval(() => {
      if (!showDesktopLyrics.value) return;
      void emitPlaybackToDesktopLyrics();
    }, DESKTOP_LYRICS_PLAYBACK_SYNC_INTERVAL_MS);
  };

  const handleAction = async (action: DesktopLyricsAction) => {
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
      case 'adjust-offset': {
        const currentOffset = settingsStore.settings.lyricsSyncOffset;
        const nextOffset = Math.max(-5, Math.min(5, currentOffset + action.delta));
        settingsStore.settings.lyricsSyncOffset = Number(nextOffset.toFixed(2));
        break;
      }
      case 'close':
        showDesktopLyrics.value = false;
        break;
      case 'update-settings': {
        const {
          showTranslation,
          showRomaji,
          ...desktopPatch
        } = action.patch;

        if (typeof showTranslation === 'boolean') {
          lyricsSettings.showTranslation = showTranslation;
        }

        if (typeof showRomaji === 'boolean') {
          lyricsSettings.showRomaji = showRomaji;
        }

        Object.assign(desktopLyricsSettings, desktopPatch);
        break;
      }
      default:
        break;
    }
  };

  const destroyDesktopLyricsWindow = async () => {
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy desktop lyrics window during shutdown:', error);
    } finally {
      desktopLyricsWindowPromise = null;
    }
  };

  onMounted(async () => {
    if (!desktopLyricsSettings.persistLock && desktopLyricsSettings.isLocked) {
      desktopLyricsSettings.isLocked = false;
    }

    unlisteners.push(await mainWindow.onCloseRequested(async (event) => {
      if (isMainWindowClosing) return;

      isMainWindowClosing = true;
      event.preventDefault();
      stopSyncLoop();
      await destroyDesktopLyricsWindow();
      await mainWindow.close();
    }));

    unlisteners.push(await listen(DESKTOP_LYRICS_REQUEST_STATE_EVENT, () => {
      void emitStateToDesktopLyrics();
      void emitPlaybackToDesktopLyrics();
    }));

    unlisteners.push(await listen<DesktopLyricsAction>(DESKTOP_LYRICS_ACTION_EVENT, (event) => {
      void handleAction(event.payload);
    }));

    unlisteners.push(await listen<{ visible: boolean }>(DESKTOP_LYRICS_VISIBILITY_EVENT, (event) => {
      showDesktopLyrics.value = event.payload.visible;
    }));

    unlisteners.push(await listen<DesktopLyricsWindowBounds>(DESKTOP_LYRICS_BOUNDS_EVENT, (event) => {
      writeDesktopLyricsBounds(event.payload);
    }));

    unlisteners.push(await listen(DESKTOP_LYRICS_RESET_BOUNDS_EVENT, async () => {
      clearDesktopLyricsStoredBounds();

      if (!showDesktopLyrics.value) {
        return;
      }

      stopSyncLoop();
      await destroyDesktopLyricsWindow();
      await openDesktopLyricsWindow();
    }));
  });

  onUnmounted(() => {
    stopSyncLoop();
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(showDesktopLyrics, async (visible) => {
    if (visible) {
      await openDesktopLyricsWindow();
      return;
    }

    stopSyncLoop();
    await destroyDesktopLyricsWindow();
  });

  watch(
    [
      parsedLyrics,
      lyricsStatus,
      () => currentSong.value?.path,
      () => currentSong.value?.title,
      () => currentSong.value?.name,
      () => currentSong.value?.artist,
      isPlaying,
      audioDelay,
      () => lyricsSettings.showTranslation,
      () => lyricsSettings.showRomaji,
      () => desktopLyricsSettings.isAlwaysOnTop,
      () => desktopLyricsSettings.alwaysShowShadowBackground,
      () => desktopLyricsSettings.autoHideWhenFullscreen,
      () => desktopLyricsSettings.isLocked,
      () => desktopLyricsSettings.persistLock,
      () => desktopLyricsSettings.colorScheme,
      () => desktopLyricsSettings.customPlayedColor,
      () => desktopLyricsSettings.customUnplayedColor,
      () => desktopLyricsSettings.customRomajiColor,
      () => desktopLyricsSettings.customTranslationColor,
      () => desktopLyricsSettings.playerFontScale,
      () => desktopLyricsSettings.playerLineGap,
      () => desktopLyricsSettings.playerOffsetX,
      () => desktopLyricsSettings.playerOffsetY,
      () => desktopLyricsSettings.playerAlignment,
      () => desktopLyricsSettings.playerFontPreset,
      dominantColors,
    ],
    () => {
      if (!showDesktopLyrics.value) return;
      void emitStateToDesktopLyrics();
      void emitPlaybackToDesktopLyrics();
      void syncWindowFlags();
    },
    { deep: true },
  );
}
