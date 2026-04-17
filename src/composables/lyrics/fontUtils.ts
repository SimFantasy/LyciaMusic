import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import {
  escapeFontFamilyName,
  extractPrimaryFontFamily,
  LYRICS_FONT_OPTIONS,
  normalizeCustomFontName,
  normalizeLyricsFontPreset,
  type LyricsFontOption,
} from './constants';

const builtinPrimaryFontFamilies = new Set(
  LYRICS_FONT_OPTIONS
    .map((option) => extractPrimaryFontFamily(option.fontFamily).toLocaleLowerCase())
    .filter(Boolean),
);

export function getLyricsFontFamily(preset: string): string {
  return LYRICS_FONT_OPTIONS.find((option) => option.value === preset)?.fontFamily
    ?? `${escapeFontFamilyName(normalizeLyricsFontPreset(preset))}, system-ui, sans-serif`;
}

export const systemLyricsFontOptions = ref<LyricsFontOption[]>([]);
let loadSystemLyricsFontsTask: Promise<void> | null = null;
let systemLyricsFontsLoaded = false;

function buildSystemLyricsFontOptions(fontFamilies: string[]): LyricsFontOption[] {
  const uniqueFamilies = new Set<string>();

  for (const family of fontFamilies) {
    const normalized = normalizeCustomFontName(family);
    if (!normalized) continue;
    if (builtinPrimaryFontFamilies.has(normalized.toLocaleLowerCase())) continue;
    uniqueFamilies.add(normalized);
  }

  return Array.from(uniqueFamilies)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((family) => ({
      value: family,
      label: family,
      fontFamily: `${escapeFontFamilyName(family)}, system-ui, sans-serif`,
      isSystem: true,
    }));
}

export async function loadSystemLyricsFonts(force = false) {
  if (systemLyricsFontsLoaded && !force) return;
  if (loadSystemLyricsFontsTask) return loadSystemLyricsFontsTask;

  loadSystemLyricsFontsTask = (async () => {
    try {
      const fonts = await invoke<string[]>('get_system_fonts');
      systemLyricsFontOptions.value = buildSystemLyricsFontOptions(fonts);
    } catch (error) {
      console.warn('Failed to load system fonts:', error);
      systemLyricsFontOptions.value = [];
    } finally {
      systemLyricsFontsLoaded = true;
      loadSystemLyricsFontsTask = null;
    }
  })();

  return loadSystemLyricsFontsTask;
}
