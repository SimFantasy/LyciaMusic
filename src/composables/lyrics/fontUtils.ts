import { ref } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import {
  escapeFontFamilyName,
  extractPrimaryFontFamily,
  LYRICS_FONT_OPTIONS,
  normalizeCustomFontName,
  normalizeLyricsFontPreset,
  type LyricsFontOption,
} from './constants';
import type { ImportedLyricsFont } from '../../types';

const builtinPrimaryFontFamilies = new Set(
  LYRICS_FONT_OPTIONS
    .map((option) => extractPrimaryFontFamily(option.fontFamily).toLocaleLowerCase())
    .filter(Boolean),
);

export function getLyricsFontFamily(preset: string): string {
  return LYRICS_FONT_OPTIONS.find((option) => option.value === preset)?.fontFamily
    ?? `${escapeFontFamilyName(normalizeLyricsFontPreset(preset))}, system-ui, sans-serif`;
}

export function buildImportedLyricsFontOptions(fonts: ImportedLyricsFont[]): LyricsFontOption[] {
  return fonts.map((font) => ({
    value: font.family,
    label: font.name,
    fontFamily: `${escapeFontFamilyName(font.family)}, system-ui, sans-serif`,
    isImported: true,
  }));
}

let importedLyricsFontStyleEl: HTMLStyleElement | null = null;

export function registerImportedLyricsFonts(fonts: ImportedLyricsFont[]) {
  if (typeof document === 'undefined') return;

  if (!importedLyricsFontStyleEl) {
    importedLyricsFontStyleEl = document.createElement('style');
    importedLyricsFontStyleEl.setAttribute('data-lycia-imported-lyrics-fonts', 'true');
    document.head.appendChild(importedLyricsFontStyleEl);
  }

  importedLyricsFontStyleEl.textContent = fonts
    .map((font) => {
      const sourceUrl = convertFileSrc(font.filePath);
      return [
        '@font-face {',
        `  font-family: ${escapeFontFamilyName(font.family)};`,
        `  src: url(${JSON.stringify(sourceUrl)}) format("${font.format}");`,
        '  font-display: swap;',
        '}',
      ].join('\n');
    })
    .join('\n\n');
}

export async function importLyricsFontFile(sourcePath: string): Promise<ImportedLyricsFont> {
  return invoke<ImportedLyricsFont>('import_lyrics_font', { sourcePath });
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
