import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed, nextTick, watch } from 'vue';
import { useWindowMaterial } from './windowMaterial';
import { useThemeSettings } from './useThemeSettings';

export function useAppThemeSync() {
  const { activeWindowMaterial, applyWindowMaterial, loadWindowMaterialCapabilities } = useWindowMaterial();
  const { theme, isDarkTheme } = useThemeSettings();

  const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
  const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');

  const applyTheme = async () => {
    if (isDarkTheme.value) {
      document.documentElement.classList.add('dark');
      try {
        await getCurrentWindow().setTheme('dark');
      } catch (error) {
        console.warn('Failed to set window theme:', error);
      }
      return;
    }

    document.documentElement.classList.remove('dark');
    try {
      await getCurrentWindow().setTheme('light');
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

  void loadWindowMaterialCapabilities();

  watch(
    theme,
    async () => {
      await applyTheme();
      await syncWindowMaterial();
    },
    { deep: true, immediate: true },
  );

  return {
    activeWindowMaterial,
    hasWindowMaterial,
    isMicaWindowMaterial,
    syncWindowMaterial,
  };
}
