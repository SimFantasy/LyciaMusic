import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useWindowMaterial } from './windowMaterial';
import { useThemeSettings } from './useThemeSettings';

export function useAppThemeSync() {
  const { activeWindowMaterial, applyWindowMaterial, loadWindowMaterialCapabilities } = useWindowMaterial();
  const { theme, isDarkTheme } = useThemeSettings();
  const appWindow = getCurrentWindow();

  const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
  const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');
  let restoreSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenFocusChanged: UnlistenFn | null = null;

  const applyTheme = async () => {
    if (isDarkTheme.value) {
      document.documentElement.classList.add('dark');
      try {
        await appWindow.setTheme('dark');
      } catch (error) {
        console.warn('Failed to set window theme:', error);
      }
      return;
    }

    document.documentElement.classList.remove('dark');
    try {
      await appWindow.setTheme('light');
    } catch (error) {
      console.warn('Failed to set window theme:', error);
    }
  };

  const syncWindowMaterial = async () => {
    await nextTick();
    await applyWindowMaterial(
      theme.value.windowMaterial,
      document.documentElement.classList.contains('dark'),
      theme.value.windowBlurTint,
    );
  };

  const syncThemeAndMaterial = async () => {
    await applyTheme();
    await syncWindowMaterial();
  };

  const scheduleRestoreMaterialSync = () => {
    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    void syncThemeAndMaterial();

    // DWM can finish restoring a blurred transparent window after the focus event.
    restoreSyncTimer = setTimeout(() => {
      restoreSyncTimer = null;
      void syncThemeAndMaterial();
    }, 120);
  };

  void loadWindowMaterialCapabilities();

  watch(
    theme,
    syncThemeAndMaterial,
    { deep: true, immediate: true },
  );

  onMounted(() => {
    void appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        scheduleRestoreMaterialSync();
      }
    }).then((unlisten) => {
      unlistenFocusChanged = unlisten;
    });
  });

  onBeforeUnmount(() => {
    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    if (unlistenFocusChanged) {
      unlistenFocusChanged();
      unlistenFocusChanged = null;
    }
  });

  return {
    activeWindowMaterial,
    hasWindowMaterial,
    isMicaWindowMaterial,
    syncWindowMaterial,
  };
}
