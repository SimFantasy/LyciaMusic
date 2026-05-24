import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type {
  AppSettings,
  AudioSettings,
  DesktopLyricsSettings,
  ImportedLyricsFont,
  LyricsSettings,
  SidebarSettings,
  ThemeSettings,
} from '../../types';
import {
  createDefaultDesktopLyricsSettings,
  createDefaultLyricsSettings,
  mergeDesktopLyricsSettings,
  mergeLyricsSettings,
  normalizeImportedLyricsFonts,
} from '../../composables/lyrics/constants';
import {
  createDefaultShortcutSettings,
  mergeShortcutSettings,
  type ShortcutSettingsPatch,
} from './shortcuts';

export type ThemeSettingsPatch = Partial<Omit<ThemeSettings, 'customBackground'>> & {
  customBackground?: Partial<ThemeSettings['customBackground']>;
};

export type SidebarSettingsPatch = Partial<SidebarSettings>;

export type LyricsSettingsPatch = Partial<LyricsSettings>;
export type DesktopLyricsSettingsPatch = Partial<DesktopLyricsSettings>;
export type AudioSettingsPatch = Partial<AudioSettings>;
export type ImportedLyricsFontsPatch = ImportedLyricsFont[];

export interface AppSettingsPatch
  extends Partial<Omit<AppSettings, 'theme' | 'sidebar' | 'shortcuts' | 'lyrics' | 'desktopLyrics' | 'audio' | 'customLyricsFonts'>> {
  theme?: ThemeSettingsPatch;
  sidebar?: SidebarSettingsPatch;
  shortcuts?: ShortcutSettingsPatch;
  lyrics?: LyricsSettingsPatch;
  desktopLyrics?: DesktopLyricsSettingsPatch;
  audio?: AudioSettingsPatch;
  customLyricsFonts?: ImportedLyricsFontsPatch;
}

export interface DeprecatedAppSettingsPatch extends AppSettingsPatch {
  minimizeToTray?: boolean;
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
  windowBlurTint: 50,
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
    translateX: 0,
    translateY: 0,
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

export const defaultAudioSettings: AudioSettings = {
  outputMode: 'shared',
  volumeBalance: false,
};

export const defaultAppSettings: AppSettings = {
  closeToTray: true,
  showDesktopLyrics: false,
  showQualityBadges: true,
  showSongComments: true,
  enableScrollToTopButton: true,
  libraryMinDurationSeconds: 0,
  // Deprecated compat field. Main folder-source behavior no longer depends on it.
  linkFoldersToLibrary: false,
  lyricsSyncOffset: 0,
  organizeRoot: 'D:\\Music',
  enableAutoOrganize: true,
  organizeRule: '{Artist}/{Album}/{Title}',
  audio: defaultAudioSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  theme: defaultThemeSettings,
  sidebar: defaultSidebarSettings,
  shortcuts: createDefaultShortcutSettings(),
  showTaskbarPlayer: false,
  taskbarPlayerCanDrag: false,
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

export const createDefaultAudioSettings = (): AudioSettings => ({
  ...defaultAudioSettings,
});

export const normalizeLibraryMinDurationSeconds = (
  value: number | null | undefined,
): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.round(numericValue);
};

export const createDefaultAppSettings = (): AppSettings => ({
  ...defaultAppSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  audio: createDefaultAudioSettings(),
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

export const mergeAudioSettings = (
  base: AudioSettings,
  patch: AudioSettingsPatch,
): AudioSettings => ({
  ...base,
  outputMode: patch.outputMode === 'wasapiExclusive' ? 'wasapiExclusive' : 'shared',
  volumeBalance: patch.volumeBalance ?? base.volumeBalance,
});

export const mergeAppSettings = (
  base: AppSettings,
  patch: DeprecatedAppSettingsPatch,
): AppSettings => {
  const {
    minimizeToTray: _deprecated,
    libraryMinDurationSeconds,
    ...rest
  } = patch;

  return {
    // Ignore removed legacy fields that may still exist in persisted settings.
    ...base,
    ...rest,
    libraryMinDurationSeconds: normalizeLibraryMinDurationSeconds(
      libraryMinDurationSeconds ?? base.libraryMinDurationSeconds,
    ),
    lyrics: mergeLyricsSettings(base.lyrics, patch.lyrics ?? {}),
    desktopLyrics: mergeDesktopLyricsSettings(base.desktopLyrics, patch.desktopLyrics ?? {}),
    audio: mergeAudioSettings(base.audio ?? createDefaultAudioSettings(), patch.audio ?? {}),
    customLyricsFonts: normalizeImportedLyricsFonts(patch.customLyricsFonts ?? base.customLyricsFonts),
    theme: mergeThemeSettings(base.theme, patch.theme ?? {}),
    sidebar: mergeSidebarSettings(base.sidebar, patch.sidebar ?? {}),
    shortcuts: mergeShortcutSettings(base.shortcuts, patch.shortcuts ?? {}),
  };
};

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
