import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type { AppSettings, SidebarSettings, ThemeSettings } from '../../types';
import {
  createDefaultShortcutSettings,
  mergeShortcutSettings,
  type ShortcutSettingsPatch,
} from './shortcuts';

export type ThemeSettingsPatch = Partial<Omit<ThemeSettings, 'customBackground'>> & {
  customBackground?: Partial<ThemeSettings['customBackground']>;
};

export type SidebarSettingsPatch = Partial<SidebarSettings>;

export interface AppSettingsPatch extends Partial<Omit<AppSettings, 'theme' | 'sidebar' | 'shortcuts'>> {
  theme?: ThemeSettingsPatch;
  sidebar?: SidebarSettingsPatch;
  shortcuts?: ShortcutSettingsPatch;
}

export const normalizeForegroundStyle = (
  foregroundStyle: string | null | undefined,
): ThemeSettings['customBackground']['foregroundStyle'] => (foregroundStyle === 'dark' ? 'dark' : 'light');

export const defaultThemeSettings: ThemeSettings = {
  mode: 'light',
  dynamicBgType: 'none',
  windowMaterial: 'none',
  flowColorBoost: 25,
  flowDepth: 30,
  flowSpeed: 52,
  flowTexture: 34,
  customBgPath: '',
  opacity: 0.8,
  blur: 20,
  customBackground: {
    imagePath: '',
    blur: 20,
    opacity: 1,
    maskColor: '#000000',
    maskAlpha: 0.4,
    scale: 1,
    foregroundStyle: 'light',
  },
};

export const defaultSidebarSettings: SidebarSettings = {
  showLocalMusic: true,
  showArtists: true,
  showAlbums: true,
  showFavorites: true,
  showRecent: true,
  showFolders: true,
  showStatistics: true,
};

export const defaultAppSettings: AppSettings = {
  minimizeToTray: false,
  closeToTray: false,
  showQualityBadges: true,
  // Deprecated compat field. Main folder-source behavior no longer depends on it.
  linkFoldersToLibrary: false,
  lyricsSyncOffset: 0,
  organizeRoot: 'D:\\Music',
  enableAutoOrganize: true,
  organizeRule: '{Artist}/{Album}/{Title}',
  theme: defaultThemeSettings,
  sidebar: defaultSidebarSettings,
  shortcuts: createDefaultShortcutSettings(),
};

export const createDefaultThemeSettings = (): ThemeSettings => ({
  ...defaultThemeSettings,
  customBackground: {
    ...defaultThemeSettings.customBackground,
  },
});

export const createDefaultSidebarSettings = (): SidebarSettings => ({
  ...defaultSidebarSettings,
});

export const createDefaultAppSettings = (): AppSettings => ({
  ...defaultAppSettings,
  theme: createDefaultThemeSettings(),
  sidebar: createDefaultSidebarSettings(),
  shortcuts: createDefaultShortcutSettings(),
});

export const mergeThemeSettings = (
  base: ThemeSettings,
  patch: ThemeSettingsPatch,
): ThemeSettings => {
  const mergedCustomBackground = {
    ...base.customBackground,
    ...(patch.customBackground ?? {}),
  };

  return {
    ...base,
    ...patch,
    customBackground: {
      ...mergedCustomBackground,
      foregroundStyle: normalizeForegroundStyle(mergedCustomBackground.foregroundStyle),
    },
  };
};

export const mergeSidebarSettings = (
  base: SidebarSettings,
  patch: SidebarSettingsPatch,
): SidebarSettings => ({
  ...base,
  ...patch,
});

export const mergeAppSettings = (
  base: AppSettings,
  patch: AppSettingsPatch,
): AppSettings => ({
  ...base,
  ...patch,
  theme: mergeThemeSettings(base.theme, patch.theme ?? {}),
  sidebar: mergeSidebarSettings(base.sidebar, patch.sidebar ?? {}),
  shortcuts: mergeShortcutSettings(base.shortcuts, patch.shortcuts ?? {}),
});

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(createDefaultAppSettings());
  const audioDelay = computed(() => settings.value.lyricsSyncOffset);
  const theme = computed<ThemeSettings>({
    get: () => settings.value.theme,
    set: nextTheme => {
      settings.value = {
        ...settings.value,
        theme: mergeThemeSettings(createDefaultThemeSettings(), nextTheme),
      };
    },
  });
  const sidebar = computed<SidebarSettings>({
    get: () => settings.value.sidebar,
    set: nextSidebar => {
      settings.value = {
        ...settings.value,
        sidebar: mergeSidebarSettings(createDefaultSidebarSettings(), nextSidebar),
      };
    },
  });

  const replaceSettings = (nextSettings: AppSettings) => {
    settings.value = mergeAppSettings(createDefaultAppSettings(), nextSettings);
  };

  const patchSettings = (partialSettings: AppSettingsPatch) => {
    settings.value = mergeAppSettings(settings.value, partialSettings);
  };

  const resetSettings = () => {
    settings.value = createDefaultAppSettings();
  };

  const replaceTheme = (nextTheme: ThemeSettings) => {
    theme.value = nextTheme;
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => {
    settings.value = {
      ...settings.value,
      theme: mergeThemeSettings(settings.value.theme, partialTheme),
    };
  };

  const replaceSidebar = (nextSidebar: SidebarSettings) => {
    sidebar.value = nextSidebar;
  };

  const patchSidebar = (partialSidebar: SidebarSettingsPatch) => {
    settings.value = {
      ...settings.value,
      sidebar: mergeSidebarSettings(settings.value.sidebar, partialSidebar),
    };
  };

  return {
    settings,
    audioDelay,
    theme,
    sidebar,
    replaceSettings,
    patchSettings,
    resetSettings,
    replaceTheme,
    patchTheme,
    replaceSidebar,
    patchSidebar,
  };
});
