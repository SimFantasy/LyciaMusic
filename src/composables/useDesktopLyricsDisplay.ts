import { emitTo } from '@tauri-apps/api/event';
import { computed, ref, watch, type CSSProperties, type Ref } from 'vue';

import {
  DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_TEXT_OPACITY,
  DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  MAX_DESKTOP_TEXT_OPACITY,
  MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
  LYRICS_FONT_OPTIONS,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  MIN_DESKTOP_TEXT_OPACITY,
  MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
  getLyricsFontFamily,
  normalizeHexColor,
  normalizeDesktopPlayerAlignment,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type LyricsStatus,
  type LyricLine,
  type LyricWord,
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

const PSEUDO_WORD_FINISH_LEAD_SECONDS = 0.08;
const DEFAULT_PSEUDO_WORD_DURATION_SECONDS = 3;
const DEFAULT_SHADOW_RGB = '0 0 0';
const FIRST_LINE_TEXT_SHADOW = [
  '0 1px 2px rgb(var(--desktop-text-shadow-color) / calc(var(--desktop-first-line-text-shadow-alpha) * 0.55))',
  '0 0 var(--desktop-first-line-text-shadow-blur) rgb(var(--desktop-text-shadow-color) / var(--desktop-first-line-text-shadow-alpha))',
].join(', ');

export const DESKTOP_LYRICS_ALIGNMENT_OPTIONS: Array<{
  value: DesktopLyricsWindowSettings['playerAlignment'];
  label: string;
}> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

type DesktopLyricSecondaryLine = { kind: 'romaji' | 'translation'; text: string };

interface DesktopLyricDisplayLine {
  line: LyricLine;
  lineIndex: number;
  active: boolean;
  words: LyricWord[];
  secondaryLines: DesktopLyricSecondaryLine[];
}

export function useDesktopLyricsDisplay(showDragShadow: Ref<boolean>) {
  const playbackTime = ref(0);
  const isPlaying = ref(false);
  const audioDelay = ref(0);
  const parsedLyrics = ref<LyricLine[]>([]);
  const lyricsStatus = ref<LyricsStatus>('idle');
  const fallbackText = ref('Instrumental / No lyrics');
  const themeColors = ref<string[]>([]);
  const songDuration = ref<number | null>(null);
  const doubleLinePageStartIndex = ref(-1);
  const settings = ref<DesktopLyricsWindowSettings>({
    showTranslation: true,
    showRomaji: false,
    isAlwaysOnTop: false,
    alwaysShowShadowBackground: false,
    autoHideWhenFullscreen: true,
    autoHideWhenPaused: false,
    showDoubleLine: false,
    enableWordEffect: true,
    isLocked: false,
    persistLock: false,
    colorScheme: 'auto',
    customPlayedColor: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
    customUnplayedColor: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
    customRomajiColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
    customTranslationColor: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
    textOpacity: DEFAULT_DESKTOP_TEXT_OPACITY,
    textShadowColor: DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
    firstLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
    secondLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
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

    if (typeof normalizedPatch.playerAlignment === 'string') {
      normalizedPatch.playerAlignment = normalizeDesktopPlayerAlignment(normalizedPatch.playerAlignment);
    }

    if (typeof normalizedPatch.textOpacity === 'number') {
      normalizedPatch.textOpacity = Number(
        Math.min(MAX_DESKTOP_TEXT_OPACITY, Math.max(MIN_DESKTOP_TEXT_OPACITY, normalizedPatch.textOpacity)).toFixed(2),
      );
    }

    if (typeof normalizedPatch.firstLineTextShadowStrength === 'number') {
      normalizedPatch.firstLineTextShadowStrength = Math.round(
        Math.min(
          MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
          Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, normalizedPatch.firstLineTextShadowStrength),
        ),
      );
    }

    if (typeof normalizedPatch.secondLineTextShadowStrength === 'number') {
      normalizedPatch.secondLineTextShadowStrength = Math.round(
        Math.min(
          MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
          Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, normalizedPatch.secondLineTextShadowStrength),
        ),
      );
    }

    if (typeof normalizedPatch.textShadowColor === 'string') {
      normalizedPatch.textShadowColor = normalizeHexColor(
        normalizedPatch.textShadowColor,
        DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
      );
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
    const nextSongDuration = payload.song?.duration;

    parsedLyrics.value = payload.parsedLyrics;
    lyricsStatus.value = payload.lyricsStatus;
    fallbackText.value = payload.fallbackText;
    audioDelay.value = payload.audioDelay;
    themeColors.value = [...payload.themeColors];
    songDuration.value = typeof nextSongDuration === 'number' && Number.isFinite(nextSongDuration)
      ? nextSongDuration
      : null;
    settings.value = {
      ...settings.value,
      ...payload.settings,
    };
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

  function getSecondaryLines(line: LyricLine): DesktopLyricSecondaryLine[] {
    const secondary: DesktopLyricSecondaryLine[] = [];
    if (settings.value.showRomaji && line.romaji) {
      secondary.push({ kind: 'romaji', text: line.romaji });
    }
    if (settings.value.showTranslation && line.translation) {
      secondary.push({ kind: 'translation', text: line.translation });
    }
    return secondary;
  }

  function getPseudoWordEnd(line: LyricLine, lineIndex: number, start: number): number {
    const parsedEnd = Number.isFinite(line.endTime) && line.endTime > start
      ? line.endTime
      : start + DEFAULT_PSEUDO_WORD_DURATION_SECONDS;
    const nextStart = parsedLyrics.value[lineIndex + 1]?.time;
    const visibleBoundary = typeof nextStart === 'number' && Number.isFinite(nextStart) && nextStart > start
      ? nextStart
      : songDuration.value;

    if (typeof visibleBoundary === 'number' && Number.isFinite(visibleBoundary) && visibleBoundary > start) {
      const visibleEnd = Math.max(start, visibleBoundary - PSEUDO_WORD_FINISH_LEAD_SECONDS);
      return Math.min(parsedEnd, visibleEnd);
    }

    return parsedEnd;
  }

  function getMainDisplayWords(line: LyricLine, lineIndex: number): LyricWord[] {
    if (!settings.value.enableWordEffect) {
      return [];
    }

    const timedWords = (line.words ?? []).filter((word) => (
      word.text.length > 0
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.end > word.start
    ));
    if (timedWords.length > 0) return timedWords;

    const text = line.text || '';
    if (!text) return [];

    const start = Number.isFinite(line.time) ? line.time : 0;
    const end = Math.max(start + 0.001, getPseudoWordEnd(line, lineIndex, start));

    return [{
      text,
      start,
      end,
      romaji: '',
    }];
  }

  function formatOffset(value: number) {
    return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
  }

  function formatCssNumber(value: number) {
    return Number(value.toFixed(2)).toString();
  }

  function hexToRgbTriplet(value: string) {
    const normalized = normalizeHexColor(value, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
    if (!match) return DEFAULT_SHADOW_RGB;

    return [
      Number.parseInt(match[1], 16),
      Number.parseInt(match[2], 16),
      Number.parseInt(match[3], 16),
    ].join(' ');
  }

  const syncedCurrentTime = computed(() => Math.max(0, playbackTime.value - audioDelay.value));
  const lyricsAlignmentClass = computed(() => {
    if (settings.value.playerAlignment === 'split-corners') {
      return settings.value.showDoubleLine ? 'lyrics-align-split-corners' : 'lyrics-align-left';
    }

    return `lyrics-align-${settings.value.playerAlignment}`;
  });
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
      '--desktop-lyric-solid-color': settings.value.colorScheme === 'custom'
        ? settings.value.customPlayedColor
        : 'var(--desktop-accent-a)',
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
      '--desktop-text-opacity': formatCssNumber(settings.value.textOpacity),
      '--desktop-text-shadow-color': hexToRgbTriplet(settings.value.textShadowColor),
      '--desktop-first-line-text-shadow-alpha': formatCssNumber(settings.value.firstLineTextShadowStrength / 100),
      '--desktop-first-line-text-shadow-blur': `${Math.round(settings.value.firstLineTextShadowStrength * 0.24)}px`,
      '--desktop-second-line-text-shadow-alpha': formatCssNumber(settings.value.secondLineTextShadowStrength / 100),
      '--desktop-second-line-text-shadow-blur': `${Math.round(settings.value.secondLineTextShadowStrength * 0.24)}px`,
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
  watch(
    [activeLyricIndex, parsedLyrics, () => settings.value.showDoubleLine],
    () => {
      if (parsedLyrics.value.length === 0) {
        doubleLinePageStartIndex.value = -1;
        return;
      }

      const currentIndex = activeLyricIndex.value >= 0 ? activeLyricIndex.value : 0;
      if (!settings.value.showDoubleLine) {
        doubleLinePageStartIndex.value = currentIndex;
        return;
      }

      const pageStartIndex = doubleLinePageStartIndex.value;
      const pageEndIndex = pageStartIndex + 1;
      if (pageStartIndex < 0 || currentIndex < pageStartIndex || currentIndex > pageEndIndex) {
        doubleLinePageStartIndex.value = currentIndex;
      }
    },
    { immediate: true },
  );
  const visiblePairStartIndex = computed(() => {
    if (parsedLyrics.value.length === 0) return -1;
    if (!settings.value.showDoubleLine) {
      return activeLyricIndex.value >= 0 ? activeLyricIndex.value : 0;
    }

    return doubleLinePageStartIndex.value >= 0 ? doubleLinePageStartIndex.value : 0;
  });
  const blockTransitionKey = computed(() => {
    if (!activeLyricLine.value) return `${lyricsStatus.value}:${fallbackText.value}`;

    if (!settings.value.showDoubleLine) {
      const line = activeLyricLine.value;
      return `${line.time}:${line.text}:${line.translation}:${line.romaji}`;
    }

    const firstLine = parsedLyrics.value[visiblePairStartIndex.value];
    const secondLine = parsedLyrics.value[visiblePairStartIndex.value + 1];
    return [
      firstLine ? `${firstLine.time}:${firstLine.text}:${firstLine.translation}:${firstLine.romaji}` : '',
      secondLine ? `${secondLine.time}:${secondLine.text}:${secondLine.translation}:${secondLine.romaji}` : '',
    ].join('|');
  });
  const visibleLyricLines = computed<DesktopLyricDisplayLine[]>(() => {
    if (parsedLyrics.value.length === 0 || visiblePairStartIndex.value < 0) return [];

    const lineCount = settings.value.showDoubleLine ? 2 : 1;
    const lines: DesktopLyricDisplayLine[] = [];

    for (let offset = 0; offset < lineCount; offset += 1) {
      const lineIndex = visiblePairStartIndex.value + offset;
      const line = parsedLyrics.value[lineIndex];
      if (!line) continue;

      lines.push({
        line,
        lineIndex,
        active: activeLyricIndex.value >= 0 ? lineIndex === activeLyricIndex.value : lineIndex === 0,
        words: getMainDisplayWords(line, lineIndex),
        secondaryLines: getSecondaryLines(line),
      });
    }

    return lines;
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
        textShadow: FIRST_LINE_TEXT_SHADOW,
      };
    }

    const highlightStop = `${Math.round(progress * 100)}%`;

    return {
      backgroundImage: `linear-gradient(90deg, var(--desktop-accent-a) 0%, var(--desktop-accent-b) ${highlightStop}, var(--desktop-text-primary) ${highlightStop}, var(--desktop-text-primary) 100%)`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
      textShadow: progress >= 1
        ? `${FIRST_LINE_TEXT_SHADOW}, 0 0 14px color-mix(in srgb, var(--desktop-accent-b) 45%, transparent)`
        : FIRST_LINE_TEXT_SHADOW,
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
    visibleLyricLines,
    blockStyle,
    handlePayload,
    handlePlaybackPayload,
    patchSettings,
    emitAction,
    getWordStyle,
  };
}
