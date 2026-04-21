import { emitTo } from '@tauri-apps/api/event';
import { computed, ref, type CSSProperties, type Ref } from 'vue';

import {
  DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  LYRICS_FONT_OPTIONS,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  getLyricsFontFamily,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type LyricsStatus,
  type LyricLine,
} from './lyrics';
import {
  DESKTOP_LYRICS_ACTION_EVENT,
  type DesktopLyricsAction,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsSettingsPatch,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowSettings,
} from '../features/desktopLyrics/shared';

const FIXED_PALETTES = {
  auto: ['#8ec5ff', '#ff8cab', '#88f3c2', '#ffe07d'],
  default: ['#EC4141', '#ff8364', '#f7b267', '#ffd166'],
  pink: ['#f472b6', '#fb7185', '#f9a8d4', '#fbcfe8'],
  blue: ['#60a5fa', '#38bdf8', '#93c5fd', '#bfdbfe'],
  green: ['#34d399', '#22c55e', '#6ee7b7', '#bbf7d0'],
  white: ['#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af'],
} as const;

export const DESKTOP_LYRICS_ALIGNMENT_OPTIONS: Array<{
  value: DesktopLyricsWindowSettings['playerAlignment'];
  label: string;
}> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

export function useDesktopLyricsDisplay(showDragShadow: Ref<boolean>) {
  const playbackTime = ref(0);
  const isPlaying = ref(false);
  const audioDelay = ref(0);
  const parsedLyrics = ref<LyricLine[]>([]);
  const lyricsStatus = ref<LyricsStatus>('idle');
  const fallbackText = ref('Instrumental / No lyrics');
  const themeColors = ref<string[]>([]);
  const settings = ref<DesktopLyricsWindowSettings>({
    showTranslation: true,
    showRomaji: false,
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
  });

  async function emitAction(action: DesktopLyricsAction) {
    await emitTo<DesktopLyricsAction>('main', DESKTOP_LYRICS_ACTION_EVENT, action);
  }

  function syncPlaybackClock(nextTime: number, nextIsPlaying: boolean, nextSyncedAt: number) {
    const elapsed = nextIsPlaying ? Math.max(0, (Date.now() - nextSyncedAt) / 1000) : 0;
    playbackTime.value = Math.max(0, nextTime + elapsed);
    isPlaying.value = nextIsPlaying;
  }

  function patchSettings(patch: DesktopLyricsSettingsPatch) {
    const normalizedPatch: DesktopLyricsSettingsPatch = { ...patch };

    if (typeof normalizedPatch.playerFontScale === 'number') {
      normalizedPatch.playerFontScale = Number(
        Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, normalizedPatch.playerFontScale)).toFixed(2),
      );
    }

    if (typeof normalizedPatch.playerLineGap === 'number') {
      normalizedPatch.playerLineGap = Number(
        Math.min(MAX_PLAYER_LINE_GAP, Math.max(MIN_PLAYER_LINE_GAP, normalizedPatch.playerLineGap)).toFixed(2),
      );
    }

    if (typeof normalizedPatch.playerOffsetX === 'number') {
      normalizedPatch.playerOffsetX = Number(
        Math.min(MAX_PLAYER_OFFSET_X, Math.max(MIN_PLAYER_OFFSET_X, normalizedPatch.playerOffsetX)).toFixed(0),
      );
    }

    if (typeof normalizedPatch.playerOffsetY === 'number') {
      normalizedPatch.playerOffsetY = Number(
        Math.min(MAX_PLAYER_OFFSET_Y, Math.max(MIN_PLAYER_OFFSET_Y, normalizedPatch.playerOffsetY)).toFixed(0),
      );
    }

    if (typeof normalizedPatch.playerFontPreset === 'string') {
      normalizedPatch.playerFontPreset = normalizeLyricsFontPreset(normalizedPatch.playerFontPreset);
    }

    settings.value = {
      ...settings.value,
      ...normalizedPatch,
    };

    void emitAction({
      type: 'update-settings',
      patch: normalizedPatch,
    });
  }

  function handlePayload(payload: DesktopLyricsStatePayload) {
    parsedLyrics.value = payload.parsedLyrics;
    lyricsStatus.value = payload.lyricsStatus;
    fallbackText.value = payload.fallbackText;
    audioDelay.value = payload.audioDelay;
    themeColors.value = [...payload.themeColors];
    settings.value = { ...payload.settings };
    syncPlaybackClock(payload.playbackTime, payload.isPlaying, payload.syncedAt);
  }

  function handlePlaybackPayload(payload: DesktopLyricsPlaybackPayload) {
    audioDelay.value = payload.audioDelay;
    syncPlaybackClock(payload.playbackTime, payload.isPlaying, payload.syncedAt);
  }

  function normalizeThemeColors(colors: string[]) {
    const normalized = colors.filter((color) => color && color !== 'transparent');
    if (normalized.length === 0) {
      return [...FIXED_PALETTES.auto];
    }

    const palette = [...normalized];
    while (palette.length < 4) {
      palette.push(palette[palette.length - 1] || FIXED_PALETTES.auto[palette.length]);
    }

    return palette.slice(0, 4);
  }

  function findLyricIndexByTime(lines: LyricLine[], targetTime: number): number {
    let left = 0;
    let right = lines.length - 1;
    let answer = -1;

    while (left <= right) {
      const mid = (left + right) >> 1;
      if (lines[mid].time <= targetTime) {
        answer = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return answer;
  }

  function formatOffset(value: number) {
    return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
  }

  const syncedCurrentTime = computed(() => Math.max(0, playbackTime.value - audioDelay.value));
  const lyricsAlignmentClass = computed(() => `lyrics-align-${settings.value.playerAlignment}`);
  const availableFontOptions = computed(() => [
    ...LYRICS_FONT_OPTIONS,
    ...systemLyricsFontOptions.value,
  ]);
  const offsetLabel = computed(() => {
    const offsetMs = Math.round(audioDelay.value * 1000);
    if (offsetMs === 0) return '0 ms';
    return `${offsetMs > 0 ? '+' : ''}${offsetMs} ms`;
  });
  const fontScaleLabel = computed(() => `${Math.round(settings.value.playerFontScale * 100)}%`);
  const lineGapLabel = computed(() => `${Math.round(settings.value.playerLineGap * 100)}%`);
  const offsetXLabel = computed(() => formatOffset(settings.value.playerOffsetX));
  const offsetYLabel = computed(() => formatOffset(settings.value.playerOffsetY));
  const selectedFontLabel = computed(() => {
    return availableFontOptions.value.find((option) => option.value === settings.value.playerFontPreset)?.label
      ?? normalizeLyricsFontPreset(settings.value.playerFontPreset);
  });
  const fallbackStateText = computed(() => {
    if (lyricsStatus.value === 'loading') return 'Loading lyrics...';
    if (lyricsStatus.value === 'error') return 'Lyrics unavailable';
    return fallbackText.value;
  });
  const lyricsPlayerStyle = computed(() => ({
    '--desktop-font-scale': settings.value.playerFontScale.toString(),
    '--lyrics-font-family': getLyricsFontFamily(settings.value.playerFontPreset),
    '--lyrics-offset-x': `${settings.value.playerOffsetX}%`,
    '--lyrics-offset-y': `${settings.value.playerOffsetY}%`,
  }));
  const resolvedPalette = computed(() => {
    if (settings.value.colorScheme === 'custom') {
      return [
        settings.value.customPlayedColor,
        settings.value.customPlayedColor,
        settings.value.customPlayedColor,
        settings.value.customUnplayedColor,
      ];
    }

    if (settings.value.colorScheme === 'auto') {
      return normalizeThemeColors(themeColors.value);
    }

    return [...FIXED_PALETTES[settings.value.colorScheme]];
  });
  const widgetStyle = computed(() => {
    const shouldShowSurface = showDragShadow.value || settings.value.alwaysShowShadowBackground;

    return {
      '--desktop-accent-a': resolvedPalette.value[0],
      '--desktop-accent-b': resolvedPalette.value[1],
      '--desktop-accent-c': resolvedPalette.value[2],
      '--desktop-accent-d': resolvedPalette.value[3],
      '--desktop-text-primary': settings.value.colorScheme === 'custom'
        ? settings.value.customUnplayedColor
        : 'rgba(255, 255, 255, 0.98)',
      '--desktop-text-secondary': 'rgba(255, 255, 255, 0.88)',
      '--desktop-text-tertiary': 'rgba(255, 255, 255, 0.76)',
      '--desktop-romaji-color': settings.value.colorScheme === 'custom'
        ? settings.value.customRomajiColor
        : 'color-mix(in srgb, var(--desktop-accent-d) 42%, var(--desktop-text-secondary))',
      '--desktop-translation-color': settings.value.colorScheme === 'custom'
        ? settings.value.customTranslationColor
        : 'color-mix(in srgb, var(--desktop-accent-c) 28%, var(--desktop-text-tertiary))',
      outline: shouldShowSurface ? '1px solid rgba(255, 255, 255, 0.16)' : 'none',
    } as Record<string, string>;
  });
  const activeLyricIndex = computed(() => {
    if (parsedLyrics.value.length === 0) return -1;
    return findLyricIndexByTime(parsedLyrics.value, syncedCurrentTime.value);
  });
  const activeLyricLine = computed<LyricLine | null>(() => {
    if (parsedLyrics.value.length === 0) {
      return null;
    }

    if (activeLyricIndex.value >= 0) {
      return parsedLyrics.value[activeLyricIndex.value] ?? null;
    }

    return parsedLyrics.value[0] ?? null;
  });
  const blockTransitionKey = computed(() => {
    const line = activeLyricLine.value;
    if (!line) return `${lyricsStatus.value}:${fallbackText.value}`;
    return `${line.time}:${line.text}:${line.translation}:${line.romaji}`;
  });
  const visibleSecondaryLines = computed(() => {
    const line = activeLyricLine.value;
    if (!line) return [];

    const secondary: Array<{ kind: 'romaji' | 'translation'; text: string }> = [];
    if (settings.value.showRomaji && line.romaji) {
      secondary.push({ kind: 'romaji', text: line.romaji });
    }
    if (settings.value.showTranslation && line.translation) {
      secondary.push({ kind: 'translation', text: line.translation });
    }
    return secondary;
  });
  const blockStyle = computed(() => ({
    '--desktop-line-gap': settings.value.playerLineGap.toString(),
  }));

  function getWordStyle(start: number, end: number): CSSProperties {
    const duration = Math.max(0.001, end - start);
    const progress = Math.max(0, Math.min(1, (syncedCurrentTime.value - start) / duration));

    if (progress <= 0) {
      return {
        color: 'var(--desktop-text-primary)',
        textShadow: '0 1px 8px rgba(0, 0, 0, 0.18)',
      };
    }

    const highlightStop = `${Math.round(progress * 100)}%`;

    return {
      backgroundImage: `linear-gradient(90deg, var(--desktop-accent-a) 0%, var(--desktop-accent-b) ${highlightStop}, var(--desktop-text-primary) ${highlightStop}, var(--desktop-text-primary) 100%)`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
      textShadow: progress >= 1 ? '0 0 14px color-mix(in srgb, var(--desktop-accent-b) 45%, transparent)' : 'none',
      filter: progress > 0 && progress < 1 ? 'drop-shadow(0 0 10px color-mix(in srgb, var(--desktop-accent-a) 30%, transparent))' : 'none',
      transition: 'filter 120ms linear, text-shadow 120ms linear',
    };
  }

  return {
    playbackTime,
    isPlaying,
    settings,
    availableFontOptions,
    offsetLabel,
    fontScaleLabel,
    lineGapLabel,
    offsetXLabel,
    offsetYLabel,
    selectedFontLabel,
    lyricsAlignmentClass,
    fallbackStateText,
    lyricsPlayerStyle,
    widgetStyle,
    activeLyricLine,
    blockTransitionKey,
    visibleSecondaryLines,
    blockStyle,
    handlePayload,
    handlePlaybackPayload,
    patchSettings,
    emitAction,
    getWordStyle,
  };
}
