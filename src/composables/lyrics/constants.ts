import type {
  DesktopLyricsSettings,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsSettings,
} from '../../types';

export const LEGACY_LYRICS_SETTINGS_KEY = 'lyrics_settings';
export const LEGACY_DESKTOP_LYRICS_SETTINGS_KEY = 'desktop_lyrics_settings';

export const DEFAULT_PLAYER_FONT_SCALE = 1;
export const MIN_PLAYER_FONT_SCALE = 0.5;
export const MAX_PLAYER_FONT_SCALE = 1.5;
export const DEFAULT_PLAYER_LINE_GAP = 1;
export const MIN_PLAYER_LINE_GAP = 0.5;
export const MAX_PLAYER_LINE_GAP = 1.5;
export const DEFAULT_PLAYER_OFFSET_X = 0;
export const MIN_PLAYER_OFFSET_X = -30;
export const MAX_PLAYER_OFFSET_X = 30;
export const DEFAULT_PLAYER_OFFSET_Y = 0;
export const MIN_PLAYER_OFFSET_Y = -25;
export const MAX_PLAYER_OFFSET_Y = 25;
export const DEFAULT_PLAYER_ALIGNMENT: LyricsPlayerAlignment = 'left';
export const DEFAULT_DESKTOP_PLAYER_ALIGNMENT: LyricsPlayerAlignment = 'center';
export const DEFAULT_PLAYER_FONT_PRESET: LyricsFontPreset = 'system';
export const DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR = '#EC4141';
export const DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR = '#FFFFFF';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR = '#BFDBFE';
export const DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR = '#FBCFE8';

export interface LyricsFontOption {
  value: LyricsFontPreset;
  label: string;
  fontFamily: string;
  isSystem?: boolean;
}

export const LYRICS_FONT_OPTIONS = [
  {
    value: 'system',
    label: '跟随系统默认',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    value: 'yahei',
    label: '微软雅黑',
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    value: 'dengxian',
    label: '等线',
    fontFamily: '"DengXian", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    value: 'songti',
    label: '宋体',
    fontFamily: '"SimSun", "Songti SC", "STSong", serif',
  },
  {
    value: 'heiti',
    label: '黑体',
    fontFamily: '"SimHei", "Heiti SC", "Microsoft YaHei", sans-serif',
  },
  {
    value: 'kaiti',
    label: '楷体',
    fontFamily: '"KaiTi", "Kaiti SC", "STKaiti", serif',
  },
  {
    value: 'arial',
    label: 'Arial',
    fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  },
  {
    value: 'georgia',
    label: 'Georgia',
    fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    value: 'mono',
    label: '等宽字体',
    fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
] as const satisfies ReadonlyArray<LyricsFontOption>;

export const defaultLyricsSettings: LyricsSettings = {
  showTranslation: true,
  showRomaji: false,
  playerFontScale: DEFAULT_PLAYER_FONT_SCALE,
  playerLineGap: DEFAULT_PLAYER_LINE_GAP,
  playerOffsetX: DEFAULT_PLAYER_OFFSET_X,
  playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
  playerAlignment: DEFAULT_PLAYER_ALIGNMENT,
  playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
};

export const defaultDesktopLyricsSettings: DesktopLyricsSettings = {
  isAlwaysOnTop: false,
  alwaysShowShadowBackground: false,
  autoHideWhenFullscreen: true,
  isLocked: false,
  persistLock: false,
  colorScheme: 'auto',
  customPlayedColor: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  customUnplayedColor: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  customRomajiColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
  customTranslationColor: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  playerFontScale: DEFAULT_PLAYER_FONT_SCALE,
  playerLineGap: DEFAULT_PLAYER_LINE_GAP,
  playerOffsetX: DEFAULT_PLAYER_OFFSET_X,
  playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
  playerAlignment: DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
  playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
};

export function createDefaultLyricsSettings(): LyricsSettings {
  return { ...defaultLyricsSettings };
}

export function createDefaultDesktopLyricsSettings(): DesktopLyricsSettings {
  return { ...defaultDesktopLyricsSettings };
}

export function clampPlayerFontScale(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_FONT_SCALE;
  return Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, value));
}

export function clampPlayerLineGap(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_LINE_GAP;
  return Math.min(MAX_PLAYER_LINE_GAP, Math.max(MIN_PLAYER_LINE_GAP, value));
}

export function clampPlayerOffsetX(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_OFFSET_X;
  return Math.min(MAX_PLAYER_OFFSET_X, Math.max(MIN_PLAYER_OFFSET_X, value));
}

export function clampPlayerOffsetY(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_OFFSET_Y;
  return Math.min(MAX_PLAYER_OFFSET_Y, Math.max(MIN_PLAYER_OFFSET_Y, value));
}

export function normalizePlayerAlignment(
  value: unknown,
  fallback: LyricsPlayerAlignment = DEFAULT_PLAYER_ALIGNMENT,
): LyricsPlayerAlignment {
  return value === 'center' || value === 'right' || value === 'left' ? value : fallback;
}

export function normalizeLyricsColorScheme(value: unknown): LyricsColorScheme {
  return value === 'default'
    || value === 'pink'
    || value === 'blue'
    || value === 'green'
    || value === 'white'
    || value === 'custom'
    ? value
    : 'auto';
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

export function normalizeCustomFontName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function escapeFontFamilyName(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function normalizeLyricsFontPreset(value: unknown): LyricsFontPreset {
  if (typeof value !== 'string') return DEFAULT_PLAYER_FONT_PRESET;

  const normalized = normalizeCustomFontName(value);
  if (!normalized) return DEFAULT_PLAYER_FONT_PRESET;

  return normalized;
}

export function extractPrimaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    ?? '';
}

export function normalizeLyricsSettingsPatch(patch: Partial<LyricsSettings>): LyricsSettings {
  return {
    ...defaultLyricsSettings,
    ...patch,
    showTranslation: typeof patch.showTranslation === 'boolean'
      ? patch.showTranslation
      : defaultLyricsSettings.showTranslation,
    showRomaji: typeof patch.showRomaji === 'boolean'
      ? patch.showRomaji
      : defaultLyricsSettings.showRomaji,
    playerFontScale: clampPlayerFontScale(patch.playerFontScale ?? DEFAULT_PLAYER_FONT_SCALE),
    playerLineGap: clampPlayerLineGap(patch.playerLineGap ?? DEFAULT_PLAYER_LINE_GAP),
    playerOffsetX: clampPlayerOffsetX(patch.playerOffsetX ?? DEFAULT_PLAYER_OFFSET_X),
    playerOffsetY: clampPlayerOffsetY(patch.playerOffsetY ?? DEFAULT_PLAYER_OFFSET_Y),
    playerAlignment: normalizePlayerAlignment(patch.playerAlignment, DEFAULT_PLAYER_ALIGNMENT),
    playerFontPreset: normalizeLyricsFontPreset(patch.playerFontPreset),
  };
}

export function normalizeDesktopLyricsSettingsPatch(
  patch: Partial<DesktopLyricsSettings>,
): DesktopLyricsSettings {
  return {
    ...defaultDesktopLyricsSettings,
    ...patch,
    isAlwaysOnTop: typeof patch.isAlwaysOnTop === 'boolean'
      ? patch.isAlwaysOnTop
      : defaultDesktopLyricsSettings.isAlwaysOnTop,
    alwaysShowShadowBackground: typeof patch.alwaysShowShadowBackground === 'boolean'
      ? patch.alwaysShowShadowBackground
      : defaultDesktopLyricsSettings.alwaysShowShadowBackground,
    autoHideWhenFullscreen: typeof patch.autoHideWhenFullscreen === 'boolean'
      ? patch.autoHideWhenFullscreen
      : defaultDesktopLyricsSettings.autoHideWhenFullscreen,
    isLocked: typeof patch.isLocked === 'boolean'
      ? patch.isLocked
      : defaultDesktopLyricsSettings.isLocked,
    persistLock: typeof patch.persistLock === 'boolean'
      ? patch.persistLock
      : defaultDesktopLyricsSettings.persistLock,
    colorScheme: normalizeLyricsColorScheme(patch.colorScheme),
    customPlayedColor: normalizeHexColor(
      patch.customPlayedColor,
      defaultDesktopLyricsSettings.customPlayedColor,
    ),
    customUnplayedColor: normalizeHexColor(
      patch.customUnplayedColor,
      defaultDesktopLyricsSettings.customUnplayedColor,
    ),
    customRomajiColor: normalizeHexColor(
      patch.customRomajiColor,
      defaultDesktopLyricsSettings.customRomajiColor,
    ),
    customTranslationColor: normalizeHexColor(
      patch.customTranslationColor,
      defaultDesktopLyricsSettings.customTranslationColor,
    ),
    playerFontScale: clampPlayerFontScale(patch.playerFontScale ?? DEFAULT_PLAYER_FONT_SCALE),
    playerLineGap: clampPlayerLineGap(patch.playerLineGap ?? DEFAULT_PLAYER_LINE_GAP),
    playerOffsetX: clampPlayerOffsetX(patch.playerOffsetX ?? DEFAULT_PLAYER_OFFSET_X),
    playerOffsetY: clampPlayerOffsetY(patch.playerOffsetY ?? DEFAULT_PLAYER_OFFSET_Y),
    playerAlignment: normalizePlayerAlignment(
      patch.playerAlignment,
      DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
    ),
    playerFontPreset: normalizeLyricsFontPreset(patch.playerFontPreset),
  };
}

export function mergeLyricsSettings(
  base: LyricsSettings,
  patch: Partial<LyricsSettings>,
): LyricsSettings {
  return normalizeLyricsSettingsPatch({
    ...base,
    ...patch,
  });
}

export function mergeDesktopLyricsSettings(
  base: DesktopLyricsSettings,
  patch: Partial<DesktopLyricsSettings>,
): DesktopLyricsSettings {
  return normalizeDesktopLyricsSettingsPatch({
    ...base,
    ...patch,
  });
}
