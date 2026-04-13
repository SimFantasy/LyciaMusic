import { computed, onMounted, ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';
import { useWindowMaterial, type WindowMaterialMode } from './windowMaterial';

const clampFlowValue = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export function useSettingsThemeControls() {
  const { theme, patchTheme, setThemeMode, setDynamicBackgroundType, setWindowMaterial } = useThemeSettings();
  const { capabilities, loadWindowMaterialCapabilities } = useWindowMaterial();
  const showCustomModal = ref(false);
  const showFlowTuning = ref(false);

  const colorScheme = computed({
    get: () => theme.value.mode,
    set: (value: 'light' | 'dark' | 'custom') => {
      setThemeMode(value);
    },
  });

  const materialMode = computed({
    get: () => theme.value.windowMaterial,
    set: (value: WindowMaterialMode) => {
      setWindowMaterial(value);
    },
  });

  const isWindows11 = computed(
    () => capabilities.value.isWindows && (capabilities.value.windowsBuildNumber ?? 0) >= 22000,
  );
  const hasWindowMaterialSelected = computed(() => materialMode.value !== 'none');
  const hasWindowMaterialThemeConflict = computed(
    () => colorScheme.value === 'custom' || theme.value.dynamicBgType !== 'none',
  );
  const windowMaterialDisabledReason = computed<'windows11' | 'transparency' | 'theme-conflict' | null>(() => {
    if (!isWindows11.value) {
      return 'windows11';
    }

    if (capabilities.value.systemTransparencyEnabled === false) {
      return 'transparency';
    }

    if (hasWindowMaterialThemeConflict.value) {
      return 'theme-conflict';
    }

    return null;
  });
  const isWindowMaterialDisabled = computed(() => windowMaterialDisabledReason.value !== null);
  const isDynamicBgDisabled = computed(
    () => colorScheme.value === 'custom' || hasWindowMaterialSelected.value,
  );

  const setColorScheme = (mode: 'light' | 'dark' | 'custom') => {
    colorScheme.value = mode;
  };

  const setDynamicType = (type: 'none' | 'flow' | 'blur') => {
    if (isDynamicBgDisabled.value) {
      return;
    }

    setDynamicBackgroundType(type);
    if (type !== 'flow') {
      showFlowTuning.value = false;
    }
  };

  const toggleWindowMaterial = (mode: Exclude<WindowMaterialMode, 'none'>) => {
    if (isWindowMaterialDisabled.value) {
      return;
    }

    if (materialMode.value === mode) {
      materialMode.value = 'none';
      return;
    }

    materialMode.value = mode;
  };

  const openCustomModal = () => {
    showCustomModal.value = true;
  };

  const toggleFlowTuning = () => {
    if (isDynamicBgDisabled.value) {
      return;
    }

    if (theme.value.dynamicBgType !== 'flow') {
      setDynamicBackgroundType('flow');
      showFlowTuning.value = true;
      return;
    }

    showFlowTuning.value = !showFlowTuning.value;
  };

  const setFlowColorBoost = (value: number) => {
    patchTheme({ flowColorBoost: clampFlowValue(value) });
  };

  const setFlowDepth = (value: number) => {
    patchTheme({ flowDepth: clampFlowValue(value) });
  };

  const setFlowSpeed = (value: number) => {
    patchTheme({ flowSpeed: clampFlowValue(value) });
  };

  const setFlowTexture = (value: number) => {
    patchTheme({ flowTexture: clampFlowValue(value) });
  };

  onMounted(() => {
    void loadWindowMaterialCapabilities();
  });

  return {
    theme,
    showCustomModal,
    colorScheme,
    materialMode,
    isWindows11,
    hasWindowMaterialSelected,
    isWindowMaterialDisabled,
    windowMaterialDisabledReason,
    isDynamicBgDisabled,
    showFlowTuning,
    setColorScheme,
    setDynamicType,
    toggleWindowMaterial,
    openCustomModal,
    toggleFlowTuning,
    setFlowColorBoost,
    setFlowDepth,
    setFlowSpeed,
    setFlowTexture,
  };
}
