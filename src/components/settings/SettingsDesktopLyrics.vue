<script setup lang="ts">
import { emit } from '@tauri-apps/api/event';
import { Check, ChevronDown, RotateCcw } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

import {
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_TEXT_OPACITY,
  DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
  DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  buildImportedLyricsFontOptions,
  LYRICS_FONT_OPTIONS,
  MAX_DESKTOP_TEXT_OPACITY,
  MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MIN_DESKTOP_TEXT_OPACITY,
  MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  getLyricsFontFamily,
  loadSystemLyricsFonts,
  normalizeHexColor,
  normalizeDesktopPlayerAlignment,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type DesktopLyricsPlayerAlignment,
  type LyricsColorScheme,
  type LyricsFontPreset,
  useLyrics,
} from '../../composables/lyrics';
import { DESKTOP_LYRICS_RESET_BOUNDS_EVENT } from '../../features/desktopLyrics/shared';
import { useSettings } from '../../features/settings/useSettings';

const FONT_SCALE_STEP = 0.05;
const LINE_GAP_STEP = 0.05;
const OFFSET_STEP = 1;
const TEXT_OPACITY_STEP = 0.01;
const SHADOW_STRENGTH_STEP = 1;

const ALIGNMENT_OPTIONS: Array<{ value: DesktopLyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '靠右' },
  { value: 'split-corners', label: '阶梯式' },
];

const COLOR_SCHEME_OPTIONS: Array<{
  value: LyricsColorScheme;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: '封面取色', hint: '跟随当前歌曲封面颜色' },
  { value: 'default', label: '经典红', hint: '使用 Lycia 的默认红色方案' },
  { value: 'pink', label: '柔粉', hint: '偏柔和、偏梦幻的粉色搭配' },
  { value: 'blue', label: '澄蓝', hint: '更冷静的蓝色高亮' },
  { value: 'green', label: '青绿', hint: '更清爽的绿色高亮' },
  { value: 'white', label: '白色', hint: '使用当前这种偏白的清透高亮风格' },
  { value: 'custom', label: '自定义', hint: '手动选择已播放和未播放颜色' },
];

const SHADOW_COLOR_PRESETS = [
  { label: '黑', value: '#000000' },
  { label: '白', value: '#FFFFFF' },
  { label: '红', value: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR },
];

const { settings } = useSettings();
const { lyricsSettings, desktopLyricsSettings } = useLyrics();
const fontPresetFieldRef = ref<HTMLElement | null>(null);
const fontPresetTriggerRef = ref<HTMLElement | null>(null);
const fontPresetMenuRef = ref<HTMLElement | null>(null);
const isFontPresetMenuOpen = ref(false);
const fontPresetMenuStyle = ref<Record<string, string>>({});
const showLyricsSyncOffsetPanel = ref(false);
const isResettingWindowBounds = ref(false);
const isCustomColorModalOpen = ref(false);
type DesktopCustomColorKind = 'played' | 'unplayed' | 'romajiPlayed' | 'romajiUnplayed' | 'translation';
const activeCustomColorKind = ref<DesktopCustomColorKind | null>(null);
const customPickerHue = ref(0);
const customPickerSaturation = ref(100);
const customPickerValue = ref(100);
const customPreviewRef = ref<HTMLElement | null>(null);
const customColorPanelRef = ref<HTMLElement | null>(null);
const customColorPanelStyle = ref<Record<string, string>>({});
const CUSTOM_COLOR_PANEL_WIDTH = 340;
const CUSTOM_COLOR_PANEL_HEIGHT = 400;
const CUSTOM_COLOR_PANEL_GAP = 20;
const CUSTOM_COLOR_PANEL_LEFT_SHIFT = 425;

const availableFontOptions = computed(() => [
  ...buildImportedLyricsFontOptions(settings.value.customLyricsFonts),
  ...LYRICS_FONT_OPTIONS,
  ...systemLyricsFontOptions.value,
]);

const selectedFontLabel = computed(() => {
  return availableFontOptions.value.find((option) => option.value === desktopLyricsSettings.playerFontPreset)?.label
    ?? normalizeLyricsFontPreset(desktopLyricsSettings.playerFontPreset);
});
const selectedFontFamily = computed(() => {
  return availableFontOptions.value.find((option) => option.value === desktopLyricsSettings.playerFontPreset)?.fontFamily
    ?? getLyricsFontFamily(desktopLyricsSettings.playerFontPreset);
});

const fontScaleLabel = computed(() => `${Math.round(desktopLyricsSettings.playerFontScale * 100)}%`);
const lineGapLabel = computed(() => `${Math.round(desktopLyricsSettings.playerLineGap * 100)}%`);
const offsetXLabel = computed(() => formatOffsetValue(desktopLyricsSettings.playerOffsetX));
const offsetYLabel = computed(() => formatOffsetValue(desktopLyricsSettings.playerOffsetY));
const textOpacityLabel = computed(() => `${Math.round(desktopLyricsSettings.textOpacity * 100)}%`);
const firstLineTextShadowStrengthLabel = computed(() => `${desktopLyricsSettings.firstLineTextShadowStrength}`);
const secondLineTextShadowStrengthLabel = computed(() => `${desktopLyricsSettings.secondLineTextShadowStrength}`);
const isCustomShadowColor = computed(() => {
  return !SHADOW_COLOR_PRESETS.some((preset) => preset.value === desktopLyricsSettings.textShadowColor);
});
const customPreviewPlayedStyle = computed(() => ({
  color: desktopLyricsSettings.customPlayedColor,
  textShadow: `0 0 16px ${desktopLyricsSettings.customPlayedColor}66`,
}));
const customPreviewCurrentStyle = computed(() => ({
  backgroundImage: `linear-gradient(90deg, ${desktopLyricsSettings.customPlayedColor} 0%, ${desktopLyricsSettings.customPlayedColor} 56%, ${desktopLyricsSettings.customUnplayedColor} 56%, ${desktopLyricsSettings.customUnplayedColor} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  filter: `drop-shadow(0 0 12px ${desktopLyricsSettings.customPlayedColor}55)`,
}));
const customPreviewUnplayedStyle = computed(() => ({
  color: desktopLyricsSettings.customUnplayedColor,
}));
const customPreviewRomajiPlayedStyle = computed(() => ({
  color: desktopLyricsSettings.customRomajiPlayedColor,
  textShadow: `0 0 12px ${desktopLyricsSettings.customRomajiPlayedColor}44`,
}));
const customPreviewRomajiCurrentStyle = computed(() => ({
  backgroundImage: `linear-gradient(90deg, ${desktopLyricsSettings.customRomajiPlayedColor} 0%, ${desktopLyricsSettings.customRomajiPlayedColor} 56%, ${desktopLyricsSettings.customRomajiUnplayedColor} 56%, ${desktopLyricsSettings.customRomajiUnplayedColor} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  filter: `drop-shadow(0 0 10px ${desktopLyricsSettings.customRomajiPlayedColor}44)`,
}));
const customPreviewRomajiUnplayedStyle = computed(() => ({
  color: desktopLyricsSettings.customRomajiUnplayedColor,
}));
const customPreviewTranslationStyle = computed(() => ({
  color: desktopLyricsSettings.customTranslationColor,
  textShadow: `0 0 12px ${desktopLyricsSettings.customTranslationColor}44`,
}));

const lyricsSyncOffsetMs = computed({
  get: () => Math.round(settings.value.lyricsSyncOffset * 1000),
  set: (value: number | string) => {
    const next = typeof value === 'string' ? Number(value) : value;
    settings.value.lyricsSyncOffset = clampLyricsSyncOffset(next) / 1000;
  },
});

const lyricsSyncOffsetLabel = computed(() => {
  const offset = lyricsSyncOffsetMs.value;
  if (offset === 0) return '0 ms';
  return `${offset > 0 ? '+' : ''}${offset} ms`;
});
const activeCustomColorLabel = computed(() => {
  const labels: Record<DesktopCustomColorKind, string> = {
    played: '主歌词 已播放',
    unplayed: '主歌词 未播放',
    romajiPlayed: '罗马音 已播放',
    romajiUnplayed: '罗马音 未播放',
    translation: '翻译',
  };
  return activeCustomColorKind.value ? labels[activeCustomColorKind.value] : '';
});
const customPickerHueColor = computed(() => hsvToHex(customPickerHue.value, 100, 100));
const customPickerColor = computed(() => hsvToHex(
  customPickerHue.value,
  customPickerSaturation.value,
  customPickerValue.value,
));
const customPickerRgb = computed(() => hexToRgb(customPickerColor.value));

function clampFontScale(value: number) {
  return Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, value));
}

function clampLineGap(value: number) {
  return Math.min(MAX_PLAYER_LINE_GAP, Math.max(MIN_PLAYER_LINE_GAP, value));
}

function clampOffsetX(value: number) {
  return Math.min(MAX_PLAYER_OFFSET_X, Math.max(MIN_PLAYER_OFFSET_X, value));
}

function clampOffsetY(value: number) {
  return Math.min(MAX_PLAYER_OFFSET_Y, Math.max(MIN_PLAYER_OFFSET_Y, value));
}

function clampTextOpacity(value: number) {
  return Math.min(MAX_DESKTOP_TEXT_OPACITY, Math.max(MIN_DESKTOP_TEXT_OPACITY, value));
}

function clampTextShadowStrength(value: number) {
  return Math.min(MAX_DESKTOP_TEXT_SHADOW_STRENGTH, Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, value));
}

function clampLyricsSyncOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1000, Math.max(-1000, Math.round(value / 10) * 10));
}

function formatOffsetValue(value: number) {
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function clampRgb(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexToRgb(value: string) {
  const normalized = normalizeHexColor(value, '#000000');
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((channel) => clampRgb(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = clampRgb(r) / 255;
  const green = clampRgb(g) / 255;
  const blue = clampRgb(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  if (hue < 0) hue += 360;

  return {
    h: Math.round(hue),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

function hsvToHex(h: number, s: number, v: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clampPercent(s) / 100;
  const value = clampPercent(v) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = chroma; green = x;
  } else if (hue < 120) {
    red = x; green = chroma;
  } else if (hue < 180) {
    green = chroma; blue = x;
  } else if (hue < 240) {
    green = x; blue = chroma;
  } else if (hue < 300) {
    red = x; blue = chroma;
  } else {
    red = chroma; blue = x;
  }

  return rgbToHex(
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255,
  );
}

function setDesktopFontScale(value: number) {
  desktopLyricsSettings.playerFontScale = Number(clampFontScale(value).toFixed(2));
}

function setDesktopLineGap(value: number) {
  desktopLyricsSettings.playerLineGap = Number(clampLineGap(value).toFixed(2));
}

function setDesktopOffsetX(value: number) {
  desktopLyricsSettings.playerOffsetX = Number(clampOffsetX(value).toFixed(0));
}

function setDesktopOffsetY(value: number) {
  desktopLyricsSettings.playerOffsetY = Number(clampOffsetY(value).toFixed(0));
}

function setDesktopTextOpacity(value: number) {
  desktopLyricsSettings.textOpacity = Number(clampTextOpacity(value).toFixed(2));
}

function setDesktopFirstLineTextShadowStrength(value: number) {
  desktopLyricsSettings.firstLineTextShadowStrength = Number(clampTextShadowStrength(value).toFixed(0));
}

function setDesktopSecondLineTextShadowStrength(value: number) {
  desktopLyricsSettings.secondLineTextShadowStrength = Number(clampTextShadowStrength(value).toFixed(0));
}

function setDesktopTextShadowColor(value: string) {
  desktopLyricsSettings.textShadowColor = normalizeHexColor(value, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
}

function setDesktopAlignment(value: DesktopLyricsPlayerAlignment) {
  desktopLyricsSettings.playerAlignment = normalizeDesktopPlayerAlignment(value);
}

function setDesktopFontPreset(value: LyricsFontPreset) {
  desktopLyricsSettings.playerFontPreset = normalizeLyricsFontPreset(value);
}

function setDesktopColorScheme(value: LyricsColorScheme) {
  desktopLyricsSettings.colorScheme = value;
}

function selectDesktopColorScheme(value: LyricsColorScheme) {
  if (value === 'custom') {
    openCustomColorModal();
    return;
  }

  setDesktopColorScheme(value);
}

function setDesktopCustomColor(kind: DesktopCustomColorKind, value: string) {
  const fallbackMap = {
    played: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
    unplayed: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
    romajiPlayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
    romajiUnplayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
    translation: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  };
  const fallback = fallbackMap[kind];
  const normalized = normalizeHexColor(value, fallback);

  if (kind === 'played') {
    desktopLyricsSettings.customPlayedColor = normalized;
  } else if (kind === 'unplayed') {
    desktopLyricsSettings.customUnplayedColor = normalized;
  } else if (kind === 'romajiPlayed') {
    desktopLyricsSettings.customRomajiPlayedColor = normalized;
  } else if (kind === 'romajiUnplayed') {
    desktopLyricsSettings.customRomajiUnplayedColor = normalized;
    desktopLyricsSettings.customRomajiColor = normalized;
  } else {
    desktopLyricsSettings.customTranslationColor = normalized;
  }

  desktopLyricsSettings.colorScheme = 'custom';
}

function getDesktopCustomColor(kind: DesktopCustomColorKind) {
  if (kind === 'played') return desktopLyricsSettings.customPlayedColor;
  if (kind === 'unplayed') return desktopLyricsSettings.customUnplayedColor;
  if (kind === 'romajiPlayed') return desktopLyricsSettings.customRomajiPlayedColor;
  if (kind === 'romajiUnplayed') return desktopLyricsSettings.customRomajiUnplayedColor;
  return desktopLyricsSettings.customTranslationColor;
}

function syncCustomPickerFromColor(color: string) {
  const rgb = hexToRgb(color);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  customPickerHue.value = hsv.h;
  customPickerSaturation.value = hsv.s;
  customPickerValue.value = hsv.v;
}

function updateCustomColorPanelPosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 16;
  const panelWidth = Math.min(CUSTOM_COLOR_PANEL_WIDTH, window.innerWidth - viewportPadding * 2);
  const previewTop = customPreviewRef.value?.getBoundingClientRect().top ?? window.innerHeight - viewportPadding;
  const maxTopBeforePreview = previewTop - CUSTOM_COLOR_PANEL_HEIGHT - CUSTOM_COLOR_PANEL_GAP;
  const maxViewportTop = window.innerHeight - CUSTOM_COLOR_PANEL_HEIGHT - viewportPadding;
  const maxTop = Math.max(viewportPadding, Math.min(maxTopBeforePreview, maxViewportTop));
  const preferredTop = rect.top;
  const preferredLeft = rect.right + CUSTOM_COLOR_PANEL_GAP - CUSTOM_COLOR_PANEL_LEFT_SHIFT;
  const left = Math.min(
    Math.max(viewportPadding, preferredLeft),
    window.innerWidth - panelWidth - viewportPadding,
  );
  const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));

  customColorPanelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(panelWidth)}px`,
  };
}

function openCustomColorPicker(kind: DesktopCustomColorKind, event: MouseEvent) {
  const anchor = event.currentTarget as HTMLElement | null;
  activeCustomColorKind.value = kind;
  syncCustomPickerFromColor(getDesktopCustomColor(kind));
  desktopLyricsSettings.colorScheme = 'custom';
  if (anchor) {
    updateCustomColorPanelPosition(anchor);
  }
}

function applyCustomPickerColor() {
  if (!activeCustomColorKind.value) return;
  setDesktopCustomColor(activeCustomColorKind.value, customPickerColor.value);
}

function setCustomPickerHue(value: number | string) {
  const nextHue = typeof value === 'string' ? Number(value) : value;
  customPickerHue.value = Number.isFinite(nextHue) ? Math.min(359, Math.max(0, Math.round(nextHue))) : 0;
  applyCustomPickerColor();
}

function updateCustomPickerArea(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  customPickerSaturation.value = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
  customPickerValue.value = clampPercent(100 - ((event.clientY - rect.top) / rect.height) * 100);
  applyCustomPickerColor();
}

function dragCustomPickerArea(event: PointerEvent) {
  if (event.buttons !== 1) return;
  updateCustomPickerArea(event);
}

function setCustomPickerRgb(channel: 'r' | 'g' | 'b', value: number | string) {
  const rgb = customPickerRgb.value;
  const next = {
    ...rgb,
    [channel]: clampRgb(typeof value === 'string' ? Number(value) : value),
  };
  syncCustomPickerFromColor(rgbToHex(next.r, next.g, next.b));
  applyCustomPickerColor();
}

function openCustomColorModal() {
  desktopLyricsSettings.colorScheme = 'custom';
  activeCustomColorKind.value = null;
  isCustomColorModalOpen.value = true;
}

function closeCustomColorModal() {
  isCustomColorModalOpen.value = false;
  activeCustomColorKind.value = null;
}

function resetLyricsSyncOffset() {
  lyricsSyncOffsetMs.value = 0;
}

function updateFontPresetMenuPosition() {
  const trigger = fontPresetTriggerRef.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 16;
  const gap = 10;
  const preferredWidth = Math.max(rect.width, 320);
  const menuWidth = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);

  let left = rect.right - menuWidth;
  left = Math.min(left, window.innerWidth - viewportPadding - menuWidth);
  left = Math.max(viewportPadding, left);

  const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
  const availableAbove = rect.top - viewportPadding;
  const shouldOpenUpward = availableBelow < 220 && availableAbove > availableBelow;
  const availableHeight = shouldOpenUpward ? availableAbove : availableBelow;
  const maxHeight = Math.max(180, Math.min(360, availableHeight - gap));

  fontPresetMenuStyle.value = shouldOpenUpward
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
      };
}

async function toggleFontPresetMenu() {
  isFontPresetMenuOpen.value = !isFontPresetMenuOpen.value;

  if (!isFontPresetMenuOpen.value) return;

  await nextTick();
  updateFontPresetMenuPosition();

  const activeItem = fontPresetMenuRef.value?.querySelector('.desktop-font-option--active') as HTMLElement | null;
  activeItem?.scrollIntoView({ block: 'nearest' });
}

async function resetDesktopLyricsWindowBounds() {
  if (isResettingWindowBounds.value) return;

  isResettingWindowBounds.value = true;
  try {
    await emit(DESKTOP_LYRICS_RESET_BOUNDS_EVENT);
  } finally {
    isResettingWindowBounds.value = false;
  }
}

function closeFontPresetMenu() {
  isFontPresetMenuOpen.value = false;
}

function selectDesktopFontPreset(value: LyricsFontPreset) {
  setDesktopFontPreset(value);
  closeFontPresetMenu();
}

function handlePointerDownOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (fontPresetFieldRef.value?.contains(target)) return;
  if (fontPresetMenuRef.value?.contains(target)) return;
  if (customColorPanelRef.value?.contains(target)) return;
  if ((target as Element | null)?.closest?.('.desktop-color-input-shell')) return;
  activeCustomColorKind.value = null;
  closeFontPresetMenu();
}

function handleWindowEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeFontPresetMenu();
    closeCustomColorModal();
  }
}

function handleViewportChange() {
  if (!isFontPresetMenuOpen.value) return;
  updateFontPresetMenuPosition();
}

onMounted(() => {
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleWindowEscape);
  window.addEventListener('resize', handleViewportChange);
  document.addEventListener('scroll', handleViewportChange, true);
  void loadSystemLyricsFonts();
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleWindowEscape);
  window.removeEventListener('resize', handleViewportChange);
  document.removeEventListener('scroll', handleViewportChange, true);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        显示与行为
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.isAlwaysOnTop = !desktopLyricsSettings.isAlwaysOnTop"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">窗口置顶</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.isAlwaysOnTop ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.isAlwaysOnTop ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.alwaysShowShadowBackground = !desktopLyricsSettings.alwaysShowShadowBackground"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">始终显示阴影背景</div>
          </div>
          <span
            class="desktop-switch"
            :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'desktop-switch--on' : ''"
          >
            <span
              class="desktop-switch-thumb"
              :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'translate-x-5' : ''"
            />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.autoHideWhenFullscreen = !desktopLyricsSettings.autoHideWhenFullscreen"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">全屏时自动隐藏</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.autoHideWhenFullscreen ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.autoHideWhenFullscreen ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.autoHideWhenPaused = !desktopLyricsSettings.autoHideWhenPaused"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">暂停时自动隐藏</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.autoHideWhenPaused ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.autoHideWhenPaused ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.enableWordEffect = !desktopLyricsSettings.enableWordEffect"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">逐字效果</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.enableWordEffect ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.enableWordEffect ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.showDoubleLine = !desktopLyricsSettings.showDoubleLine"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">双行显示</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.showDoubleLine ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.showDoubleLine ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.isLocked = !desktopLyricsSettings.isLocked"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">锁定位置并启用鼠标穿透</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.isLocked ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.isLocked ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.persistLock = !desktopLyricsSettings.persistLock"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">记住锁定状态</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.persistLock ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.persistLock ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="lyricsSettings.showTranslation = !lyricsSettings.showTranslation"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示翻译</div>
          </div>
          <span class="desktop-switch" :class="lyricsSettings.showTranslation ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="lyricsSettings.showTranslation ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="lyricsSettings.showRomaji = !lyricsSettings.showRomaji"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示罗马音</div>
          </div>
          <span class="desktop-switch" :class="lyricsSettings.showRomaji ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="lyricsSettings.showRomaji ? 'translate-x-5' : ''" />
          </span>
        </button>

        <div class="desktop-setting-row">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">重置窗口位置</div>
          </div>
          <button
            type="button"
            class="desktop-action-button"
            :disabled="isResettingWindowBounds"
            @click="resetDesktopLyricsWindowBounds"
          >
            {{ isResettingWindowBounds ? '重置中...' : '重置' }}
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        歌词同步
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <button
          type="button"
          class="desktop-setting-row"
          @click="showLyricsSyncOffsetPanel = !showLyricsSyncOffsetPanel"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">同步偏移</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="rounded-full bg-[#EC4141]/10 px-3 py-1 text-xs font-medium text-[#EC4141] tabular-nums">
              {{ lyricsSyncOffsetLabel }}
            </div>
            <ChevronDown
              :size="16"
              class="text-gray-400 transition-transform duration-200 dark:text-white/45"
              :class="showLyricsSyncOffsetPanel ? 'rotate-180 text-[#EC4141]' : ''"
            />
          </div>
        </button>

        <transition name="desktop-expand-panel">
          <div v-if="showLyricsSyncOffsetPanel" class="desktop-setting-expand">
            <div class="desktop-setting-expand-inner">
              <div class="text-xs text-gray-600 dark:text-white/60">
                正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。
              </div>

              <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                <input
                  v-model="lyricsSyncOffsetMs"
                  type="range"
                  min="-1000"
                  max="1000"
                  step="10"
                  class="desktop-slider flex-1"
                />
                <div class="flex items-center gap-3">
                  <input
                    v-model="lyricsSyncOffsetMs"
                    type="number"
                    min="-1000"
                    max="1000"
                    step="10"
                    class="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
                    @click="resetLyricsSyncOffset"
                  >
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        排版与字体
      </h2>
      <div class="desktop-typography-panel">
        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">字号</span>
              <button
                v-if="desktopLyricsSettings.playerFontScale !== DEFAULT_PLAYER_FONT_SCALE"
                type="button"
                class="desktop-inline-reset"
                title="重置字号"
                @click="setDesktopFontScale(DEFAULT_PLAYER_FONT_SCALE)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ fontScaleLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopFontScale(desktopLyricsSettings.playerFontScale - FONT_SCALE_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.playerFontScale"
              type="range"
              :min="MIN_PLAYER_FONT_SCALE"
              :max="MAX_PLAYER_FONT_SCALE"
              :step="FONT_SCALE_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopFontScale(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopFontScale(desktopLyricsSettings.playerFontScale + FONT_SCALE_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">行距</span>
              <button
                v-if="desktopLyricsSettings.playerLineGap !== DEFAULT_PLAYER_LINE_GAP"
                type="button"
                class="desktop-inline-reset"
                title="重置行距"
                @click="setDesktopLineGap(DEFAULT_PLAYER_LINE_GAP)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ lineGapLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopLineGap(desktopLyricsSettings.playerLineGap - LINE_GAP_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.playerLineGap"
              type="range"
              :min="MIN_PLAYER_LINE_GAP"
              :max="MAX_PLAYER_LINE_GAP"
              :step="LINE_GAP_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopLineGap(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopLineGap(desktopLyricsSettings.playerLineGap + LINE_GAP_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">横向偏移</span>
              <button
                v-if="desktopLyricsSettings.playerOffsetX !== DEFAULT_PLAYER_OFFSET_X"
                type="button"
                class="desktop-inline-reset"
                title="重置横向偏移"
                @click="setDesktopOffsetX(DEFAULT_PLAYER_OFFSET_X)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ offsetXLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopOffsetX(desktopLyricsSettings.playerOffsetX - OFFSET_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.playerOffsetX"
              type="range"
              :min="MIN_PLAYER_OFFSET_X"
              :max="MAX_PLAYER_OFFSET_X"
              :step="OFFSET_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopOffsetX(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopOffsetX(desktopLyricsSettings.playerOffsetX + OFFSET_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">纵向偏移</span>
              <button
                v-if="desktopLyricsSettings.playerOffsetY !== DEFAULT_PLAYER_OFFSET_Y"
                type="button"
                class="desktop-inline-reset"
                title="重置纵向偏移"
                @click="setDesktopOffsetY(DEFAULT_PLAYER_OFFSET_Y)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ offsetYLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopOffsetY(desktopLyricsSettings.playerOffsetY - OFFSET_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.playerOffsetY"
              type="range"
              :min="MIN_PLAYER_OFFSET_Y"
              :max="MAX_PLAYER_OFFSET_Y"
              :step="OFFSET_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopOffsetY(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopOffsetY(desktopLyricsSettings.playerOffsetY + OFFSET_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">文字不透明度</span>
              <button
                v-if="desktopLyricsSettings.textOpacity !== DEFAULT_DESKTOP_TEXT_OPACITY"
                type="button"
                class="desktop-inline-reset"
                title="重置文字不透明度"
                @click="setDesktopTextOpacity(DEFAULT_DESKTOP_TEXT_OPACITY)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ textOpacityLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopTextOpacity(desktopLyricsSettings.textOpacity - TEXT_OPACITY_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.textOpacity"
              type="range"
              :min="MIN_DESKTOP_TEXT_OPACITY"
              :max="MAX_DESKTOP_TEXT_OPACITY"
              :step="TEXT_OPACITY_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopTextOpacity(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopTextOpacity(desktopLyricsSettings.textOpacity + TEXT_OPACITY_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">第一行阴影强度</span>
              <button
                v-if="desktopLyricsSettings.firstLineTextShadowStrength !== DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH"
                type="button"
                class="desktop-inline-reset"
                title="重置第一行阴影强度"
                @click="setDesktopFirstLineTextShadowStrength(DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ firstLineTextShadowStrengthLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopFirstLineTextShadowStrength(desktopLyricsSettings.firstLineTextShadowStrength - SHADOW_STRENGTH_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.firstLineTextShadowStrength"
              type="range"
              :min="MIN_DESKTOP_TEXT_SHADOW_STRENGTH"
              :max="MAX_DESKTOP_TEXT_SHADOW_STRENGTH"
              :step="SHADOW_STRENGTH_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopFirstLineTextShadowStrength(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopFirstLineTextShadowStrength(desktopLyricsSettings.firstLineTextShadowStrength + SHADOW_STRENGTH_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row">
          <div class="desktop-inline-header">
            <div class="desktop-inline-title">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">第二行阴影强度</span>
              <button
                v-if="desktopLyricsSettings.secondLineTextShadowStrength !== DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH"
                type="button"
                class="desktop-inline-reset"
                title="重置第二行阴影强度"
                @click="setDesktopSecondLineTextShadowStrength(DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH)"
              >
                <RotateCcw :size="12" />
              </button>
            </div>
            <div class="desktop-inline-value">{{ secondLineTextShadowStrengthLabel }}</div>
          </div>
          <div class="desktop-slider-row">
            <button type="button" class="desktop-mini-button" @click="setDesktopSecondLineTextShadowStrength(desktopLyricsSettings.secondLineTextShadowStrength - SHADOW_STRENGTH_STEP)">-</button>
            <input
              :value="desktopLyricsSettings.secondLineTextShadowStrength"
              type="range"
              :min="MIN_DESKTOP_TEXT_SHADOW_STRENGTH"
              :max="MAX_DESKTOP_TEXT_SHADOW_STRENGTH"
              :step="SHADOW_STRENGTH_STEP"
              class="desktop-slider flex-1"
              @input="setDesktopSecondLineTextShadowStrength(Number(($event.target as HTMLInputElement).value))"
            />
            <button type="button" class="desktop-mini-button" @click="setDesktopSecondLineTextShadowStrength(desktopLyricsSettings.secondLineTextShadowStrength + SHADOW_STRENGTH_STEP)">+</button>
          </div>
        </div>

        <div class="desktop-typography-row desktop-typography-row--inline">
          <div class="desktop-inline-title">
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">阴影颜色</span>
            <button
              v-if="desktopLyricsSettings.textShadowColor !== DEFAULT_DESKTOP_TEXT_SHADOW_COLOR"
              type="button"
              class="desktop-inline-reset"
              title="重置阴影颜色"
              @click="setDesktopTextShadowColor(DEFAULT_DESKTOP_TEXT_SHADOW_COLOR)"
            >
              <RotateCcw :size="12" />
            </button>
          </div>
          <div class="desktop-inline-actions">
            <button
              v-for="preset in SHADOW_COLOR_PRESETS"
              :key="preset.value"
              type="button"
              class="desktop-chip"
              :class="desktopLyricsSettings.textShadowColor === preset.value ? 'desktop-chip--active' : ''"
              @click="setDesktopTextShadowColor(preset.value)"
            >
              {{ preset.label }}
            </button>
            <label
              class="desktop-chip desktop-shadow-custom-chip"
              :class="isCustomShadowColor ? 'desktop-chip--active' : ''"
            >
              <input
                type="color"
                :value="desktopLyricsSettings.textShadowColor"
                aria-label="自定义阴影颜色"
                @input="setDesktopTextShadowColor(($event.target as HTMLInputElement).value)"
              >
              <span class="desktop-shadow-custom-swatch" :style="{ backgroundColor: desktopLyricsSettings.textShadowColor }"></span>
              <span>自定义</span>
            </label>
          </div>
        </div>

        <div class="desktop-typography-row desktop-typography-row--inline">
          <div class="desktop-inline-title">
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">对齐方式</span>
            <button
              v-if="desktopLyricsSettings.playerAlignment !== DEFAULT_DESKTOP_PLAYER_ALIGNMENT"
              type="button"
              class="desktop-inline-reset"
              title="重置对齐方式"
              @click="setDesktopAlignment(DEFAULT_DESKTOP_PLAYER_ALIGNMENT)"
            >
              <RotateCcw :size="12" />
            </button>
          </div>
          <div class="desktop-inline-actions">
            <button
              v-for="option in ALIGNMENT_OPTIONS"
              :key="option.value"
              type="button"
              class="desktop-chip"
              :class="desktopLyricsSettings.playerAlignment === option.value ? 'desktop-chip--active' : ''"
              @click="setDesktopAlignment(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="desktop-typography-row desktop-typography-row--inline">
          <div class="desktop-inline-title">
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">字体</span>
            <button
              v-if="desktopLyricsSettings.playerFontPreset !== DEFAULT_PLAYER_FONT_PRESET"
              type="button"
              class="desktop-inline-reset"
              title="重置字体"
              @click="setDesktopFontPreset(DEFAULT_PLAYER_FONT_PRESET)"
            >
              <RotateCcw :size="12" />
            </button>
          </div>
          <div ref="fontPresetFieldRef" class="desktop-font-picker desktop-font-picker--inline">
            <button
              ref="fontPresetTriggerRef"
              type="button"
              class="desktop-font-trigger desktop-font-trigger--compact"
              :class="isFontPresetMenuOpen ? 'desktop-font-trigger--open' : ''"
              @click="toggleFontPresetMenu"
            >
              <div class="min-w-0 flex-1 text-left">
                <div class="truncate text-[15px] font-semibold text-gray-800 dark:text-gray-100" :style="{ fontFamily: selectedFontFamily }">
                  {{ selectedFontLabel }}
                </div>
              </div>
              <ChevronDown
                :size="18"
                class="shrink-0 text-gray-400 transition-transform duration-200 dark:text-white/45"
                :class="isFontPresetMenuOpen ? 'rotate-180 text-[#EC4141]' : ''"
              />
            </button>

            <Teleport to="body">
              <transition name="desktop-font-menu">
                <div
                  v-if="isFontPresetMenuOpen"
                  ref="fontPresetMenuRef"
                  class="desktop-font-menu"
                  :style="fontPresetMenuStyle"
                  @click.stop
                  @mousedown.stop
                >
                  <div class="desktop-font-menu-header">
                    <span>字体方案</span>
                    <span>{{ availableFontOptions.length }} 项</span>
                  </div>
                  <div class="desktop-font-menu-list custom-scrollbar">
                    <button
                      v-for="option in availableFontOptions"
                      :key="option.value"
                      type="button"
                      class="desktop-font-option"
                      :class="desktopLyricsSettings.playerFontPreset === option.value ? 'desktop-font-option--active' : ''"
                      @click="selectDesktopFontPreset(option.value)"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold" :style="{ fontFamily: option.fontFamily }">
                          {{ option.label }}
                        </div>
                      </div>
                      <Check
                        v-if="desktopLyricsSettings.playerFontPreset === option.value"
                        :size="16"
                        class="shrink-0 text-[#EC4141]"
                      />
                    </button>
                  </div>
                </div>
              </transition>
            </Teleport>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        配色方案
      </h2>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="option in COLOR_SCHEME_OPTIONS"
          :key="option.value"
          type="button"
          class="rounded-2xl border px-4 py-3 text-left transition-all"
          :class="desktopLyricsSettings.colorScheme === option.value
            ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
            : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/8 dark:hover:bg-white/10'"
          @click="selectDesktopColorScheme(option.value)"
        >
          <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">{{ option.label }}</div>
        </button>
      </div>
    </section>

    <Teleport to="body">
      <transition name="desktop-custom-modal">
        <div
          v-if="isCustomColorModalOpen"
          class="desktop-custom-modal-backdrop"
          @click.self="closeCustomColorModal"
        >
          <div class="desktop-custom-modal" role="dialog" aria-modal="true" aria-label="自定义桌面歌词配色">
            <div class="desktop-custom-color-row">
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'played' }"
              >
                <span>主歌词 已播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="主歌词 已播放"
                  @click="openCustomColorPicker('played', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customPlayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'unplayed' }"
              >
                <span>主歌词 未播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="主歌词 未播放"
                  @click="openCustomColorPicker('unplayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customUnplayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'romajiPlayed' }"
              >
                <span>罗马音 已播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="罗马音 已播放"
                  @click="openCustomColorPicker('romajiPlayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customRomajiPlayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'romajiUnplayed' }"
              >
                <span>罗马音 未播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="罗马音 未播放"
                  @click="openCustomColorPicker('romajiUnplayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customRomajiUnplayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'translation' }"
              >
                <span>翻译</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="翻译"
                  @click="openCustomColorPicker('translation', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customTranslationColor }"></span>
                </button>
              </div>
            </div>

            <div
              v-if="activeCustomColorKind"
              ref="customColorPanelRef"
              class="desktop-custom-color-panel"
              :style="customColorPanelStyle"
            >
              <div class="desktop-custom-color-panel-title">{{ activeCustomColorLabel }}</div>
              <div
                class="desktop-custom-color-area"
                :style="{ backgroundColor: customPickerHueColor }"
                @pointerdown="updateCustomPickerArea"
                @pointermove="dragCustomPickerArea"
              >
                <span
                  class="desktop-custom-color-thumb"
                  :style="{
                    left: `${customPickerSaturation}%`,
                    top: `${100 - customPickerValue}%`,
                  }"
                ></span>
              </div>
              <div class="desktop-custom-hue-row">
                <span class="desktop-custom-current-color" :style="{ backgroundColor: customPickerColor }"></span>
                <input
                  class="desktop-custom-hue-slider"
                  type="range"
                  min="0"
                  max="359"
                  :value="customPickerHue"
                  aria-label="色相"
                  @input="setCustomPickerHue(($event.target as HTMLInputElement).value)"
                >
              </div>
              <div class="desktop-custom-rgb-row">
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.r"
                    @input="setCustomPickerRgb('r', ($event.target as HTMLInputElement).value)"
                  >
                  <span>R</span>
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.g"
                    @input="setCustomPickerRgb('g', ($event.target as HTMLInputElement).value)"
                  >
                  <span>G</span>
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.b"
                    @input="setCustomPickerRgb('b', ($event.target as HTMLInputElement).value)"
                  >
                  <span>B</span>
                </label>
              </div>
            </div>

            <div ref="customPreviewRef" class="desktop-custom-preview">
              <div class="desktop-custom-preview-line">
                <span :style="customPreviewPlayedStyle">初めての</span>
                <span :style="customPreviewCurrentStyle">ルーブル</span>
                <span :style="customPreviewUnplayedStyle">は</span>
              </div>
              <div class="desktop-custom-preview-sub">
                <span :style="customPreviewRomajiPlayedStyle">ha ji me te no</span>
                <span :style="customPreviewRomajiCurrentStyle">ru u bu ru</span>
                <span :style="customPreviewRomajiUnplayedStyle">wa</span>
              </div>
              <div class="desktop-custom-preview-sub desktop-custom-preview-translation" :style="customPreviewTranslationStyle">
                第一次参观卢浮宫
              </div>
            </div>

            <div class="desktop-custom-modal-actions">
              <button type="button" class="desktop-action-button desktop-custom-done-button" @click="closeCustomColorModal">完成</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:last-child {
  border-bottom: 0;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.desktop-typography-panel {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
}

.desktop-setting-expand {
  overflow: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
}

.desktop-setting-expand-inner {
  padding: 16px;
}

:global(.dark) .desktop-setting-expand {
  border-top-color: rgba(255, 255, 255, 0.05);
}

.desktop-typography-row {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  transition: background-color 160ms ease;
}

.desktop-typography-row:last-child {
  border-bottom: 0;
}

.desktop-typography-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-typography-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-typography-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.desktop-typography-row--inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.desktop-inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.desktop-inline-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.desktop-inline-value {
  color: #ec4141;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}

.desktop-inline-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(236, 65, 65, 0.16);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  flex-shrink: 0;
  line-height: 0;
}

.desktop-inline-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.desktop-switch {
  display: inline-flex;
  align-items: center;
  width: 44px;
  height: 24px;
  padding: 2px;
  border-radius: 999px;
  background: rgb(209 213 219);
  transition: background-color 160ms ease;
  flex-shrink: 0;
}

.desktop-switch--on {
  background: #ec4141;
}

:global(.dark) .desktop-switch {
  background: rgb(55 65 81);
}

:global(.dark) .desktop-switch--on {
  background: #ec4141;
}

.desktop-switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
  transition: transform 160ms ease;
}

.desktop-card {
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.55);
  padding: 18px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

:global(.dark) .desktop-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

:global(.dark) .desktop-font-trigger {
  border-color: rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 12px 28px rgba(0, 0, 0, 0.18);
}

:global(.dark) .desktop-font-trigger:hover,
:global(.dark) .desktop-font-trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 16px 36px rgba(0, 0, 0, 0.24);
}

:global(.dark) .desktop-font-trigger--open {
  background:
    linear-gradient(180deg, rgba(236, 65, 65, 0.16), rgba(255, 255, 255, 0.05));
}

:global(.dark) .desktop-font-menu {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(17, 17, 19, 0.88);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.34),
    0 10px 24px rgba(0, 0, 0, 0.24);
}

:global(.dark) .desktop-font-menu-header {
  border-bottom-color: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.58);
}

:global(.dark) .desktop-font-option {
  color: rgba(255, 255, 255, 0.84);
}

:global(.dark) .desktop-font-option:hover {
  border-color: rgba(236, 65, 65, 0.22);
  background: rgba(236, 65, 65, 0.1);
  color: rgba(255, 255, 255, 0.98);
}

:global(.dark) .desktop-font-option--active {
  border-color: rgba(236, 65, 65, 0.28);
  background:
    linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  color: #ff9a9a;
}

.desktop-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.desktop-card-value {
  margin-top: 14px;
  color: #ec4141;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1;
}

.desktop-font-picker {
  position: relative;
}

.desktop-font-picker--inline {
  width: min(185px, 100%);
  flex-shrink: 0;
}

.desktop-font-trigger {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 64px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.68));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 10px 26px rgba(15, 23, 42, 0.05);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.desktop-font-trigger--compact {
  min-height: 36px;
  padding: 7px 10px;
  border-radius: 10px;
  gap: 8px;
}

.desktop-font-trigger:hover,
.desktop-font-trigger--open {
  border-color: rgba(236, 65, 65, 0.32);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 14px 30px rgba(236, 65, 65, 0.08);
}

.desktop-font-trigger--open {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 244, 244, 0.78));
}

.desktop-font-menu {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow:
    0 24px 60px rgba(15, 23, 42, 0.16),
    0 10px 24px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  z-index: 120;
}

.desktop-font-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  color: rgba(71, 85, 105, 0.92);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.desktop-font-menu-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.desktop-font-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  text-align: left;
  color: rgb(55 65 81);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.desktop-font-option:hover {
  border-color: rgba(236, 65, 65, 0.16);
  background: rgba(236, 65, 65, 0.06);
  color: rgb(17 24 39);
}

.desktop-font-option--active {
  border-color: rgba(236, 65, 65, 0.2);
  background:
    linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  color: #ec4141;
}

.desktop-font-menu-enter-active,
.desktop-font-menu-leave-active {
  transition: opacity 180ms ease, transform 200ms ease;
  transform-origin: top center;
}

.desktop-font-menu-enter-from,
.desktop-font-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.desktop-expand-panel-enter-active,
.desktop-expand-panel-leave-active {
  transition:
    opacity 200ms ease,
    transform 220ms ease,
    max-height 220ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.desktop-expand-panel-enter-from,
.desktop-expand-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scaleY(0.96);
  max-height: 0;
}

.desktop-expand-panel-enter-to,
.desktop-expand-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scaleY(1);
  max-height: 260px;
}

.desktop-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.desktop-mini-button,
.desktop-inline-reset,
.desktop-reset-button,
.desktop-action-button,
.desktop-chip {
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.desktop-mini-button {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 16px;
}

.desktop-mini-button:hover,
.desktop-inline-reset:hover,
.desktop-reset-button:hover,
.desktop-chip:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.1);
}

.desktop-reset-button {
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 6px 10px;
  color: #ec4141;
  font-size: 12px;
}

.desktop-action-button {
  flex-shrink: 0;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 8px 14px;
  color: #ec4141;
  font-size: 12px;
}

.desktop-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.desktop-chip {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  padding: 8px 14px;
  color: rgb(55 65 81);
  font-size: 13px;
}

.desktop-chip--active {
  border-color: rgba(236, 65, 65, 0.28);
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
  font-weight: 600;
}

:global(.dark) .desktop-chip {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.82);
}

:global(.dark) .desktop-chip--active {
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.14);
  color: #ff8b8b;
}

.desktop-custom-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.desktop-custom-modal {
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  padding: 28px;
  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.22);
}

:global(.dark) .desktop-custom-modal {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.92);
}

.desktop-custom-color-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.desktop-color-picker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
  min-height: 62px;
  padding: 10px 14px 10px 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  color: rgb(31 41 55);
  font-size: 15px;
  font-weight: 700;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.desktop-color-picker > span:first-child {
  min-width: 0;
  white-space: normal;
  word-break: keep-all;
}

:global(.dark) .desktop-color-picker {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
}

.desktop-color-picker:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.06);
}

.desktop-color-picker--active {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.08);
}

.desktop-color-input-shell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.desktop-custom-color-panel {
  position: fixed;
  z-index: 155;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
}

:global(.dark) .desktop-custom-color-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.96);
}

.desktop-custom-color-panel-title {
  padding: 14px 16px 12px;
  color: rgb(31 41 55);
  font-size: 14px;
  font-weight: 800;
}

:global(.dark) .desktop-custom-color-panel-title {
  color: rgba(255, 255, 255, 0.9);
}

.desktop-custom-color-area {
  position: relative;
  height: 218px;
  cursor: crosshair;
  touch-action: none;
  background-image:
    linear-gradient(90deg, #fff, rgba(255, 255, 255, 0)),
    linear-gradient(0deg, #000, rgba(0, 0, 0, 0));
}

.desktop-custom-color-thumb {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 3px solid #fff;
  border-radius: 999px;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.75),
    0 2px 8px rgba(15, 23, 42, 0.26);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.desktop-custom-hue-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 14px 18px 10px;
}

.desktop-custom-current-color {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 4px 12px rgba(15, 23, 42, 0.14);
}

.desktop-custom-hue-slider {
  width: 100%;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  appearance: none;
  cursor: pointer;
}

.desktop-custom-hue-slider::-webkit-slider-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.2),
    0 2px 8px rgba(15, 23, 42, 0.22);
  appearance: none;
}

.desktop-custom-hue-slider::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.2),
    0 2px 8px rgba(15, 23, 42, 0.22);
}

.desktop-custom-rgb-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0 18px 16px;
}

.desktop-custom-rgb-row label {
  display: grid;
  gap: 6px;
  text-align: center;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 700;
}

:global(.dark) .desktop-custom-rgb-row label {
  color: rgba(255, 255, 255, 0.82);
}

.desktop-custom-rgb-row input {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(15, 23, 42, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  padding: 8px 6px;
  text-align: center;
  color: rgb(17 24 39);
  font-size: 15px;
  font-weight: 700;
}

:global(.dark) .desktop-custom-rgb-row input {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.desktop-shadow-custom-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  cursor: pointer;
}

.desktop-shadow-custom-chip input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.desktop-shadow-custom-swatch {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 2px 6px rgba(15, 23, 42, 0.14);
}

.desktop-color-swatch {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 14px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 4px 12px rgba(15, 23, 42, 0.14);
}

.desktop-custom-preview {
  margin-top: 18px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.12), transparent 42%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(3, 7, 18, 0.96));
  padding: 30px;
  text-align: center;
}

.desktop-custom-preview-line {
  max-width: 100%;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.18;
  overflow-wrap: anywhere;
}

.desktop-custom-preview-sub {
  font-size: 15px;
  line-height: 1.4;
  opacity: 0.86;
}

.desktop-custom-preview-translation {
  margin-top: -8px;
  font-size: 16px;
}

.desktop-custom-modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.desktop-custom-done-button {
  min-width: 108px;
  min-height: 44px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
}

.desktop-custom-modal-enter-active,
.desktop-custom-modal-leave-active {
  transition: opacity 180ms ease;
}

.desktop-custom-modal-enter-active .desktop-custom-modal,
.desktop-custom-modal-leave-active .desktop-custom-modal {
  transition: transform 180ms ease, opacity 180ms ease;
}

.desktop-custom-modal-enter-from,
.desktop-custom-modal-leave-to {
  opacity: 0;
}

.desktop-custom-modal-enter-from .desktop-custom-modal,
.desktop-custom-modal-leave-to .desktop-custom-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 767px) {
  .desktop-typography-row--inline {
    flex-direction: column;
    align-items: stretch;
  }

  .desktop-inline-actions {
    justify-content: flex-start;
  }

  .desktop-font-picker--inline {
    width: 100%;
  }

  .desktop-custom-modal {
    padding: 18px;
  }

  .desktop-color-picker {
    min-height: 58px;
    padding: 9px 12px 9px 14px;
  }

  .desktop-color-input-shell {
    width: 42px;
    height: 42px;
  }

  .desktop-custom-preview-line {
    font-size: 26px;
  }
}

.desktop-slider {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.88), rgba(251, 146, 60, 0.88));
  appearance: none;
  cursor: pointer;
}

.desktop-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
  appearance: none;
}

.desktop-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
}
</style>
