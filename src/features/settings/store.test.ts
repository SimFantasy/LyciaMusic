import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { mergeAppSettings, useSettingsStore } from './store';

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('patches theme settings without losing nested custom background fields', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        blur: 32,
      },
    });

    expect(settingsStore.theme.mode).toBe('custom');
    expect(settingsStore.theme.customBackground.imagePath).toBe('/covers/demo.jpg');
    expect(settingsStore.theme.customBackground.blur).toBe(32);
    expect(settingsStore.theme.customBackground.maskColor).toBe('#000000');
  });

  it('replaces theme through the settings domain instead of mutating ui state', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'dark',
      dynamicBgType: 'blur',
      windowMaterial: 'mica',
      flowColorBoost: 62,
      flowDepth: 54,
      flowSpeed: 48,
      flowTexture: 28,
      windowBlurTint: 50,
      customBgPath: '',
      opacity: 0.75,
      blur: 18,
      customBackground: {
        imagePath: '/covers/fallback.jpg',
        blur: 24,
        opacity: 0.85,
        maskColor: '#101010',
        maskAlpha: 0.45,
        scale: 1.08,
        foregroundStyle: 'light',
      },
    });

    expect(settingsStore.settings.theme.windowMaterial).toBe('mica');
    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('normalizes legacy auto foreground style to light', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'custom',
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
        imagePath: '/covers/legacy.jpg',
        blur: 20,
        opacity: 1,
        maskColor: '#000000',
        maskAlpha: 0.4,
        scale: 1,
        foregroundStyle: 'auto' as unknown as 'light',
      },
    });

    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('merges shortcut settings without dropping untouched bindings', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      shortcuts: {
        enabled: false,
        local: {
          togglePlay: {
            code: 'Enter',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          },
        },
      },
    });

    expect(settingsStore.settings.shortcuts.enabled).toBe(false);
    expect(settingsStore.settings.shortcuts.local.togglePlay?.code).toBe('Enter');
    expect(settingsStore.settings.shortcuts.local.nextSong?.code).toBe('ArrowRight');
    expect(settingsStore.settings.shortcuts.global.togglePlay?.code).toBe('KeyP');
  });

  it('ignores deprecated minimizeToTray when merging persisted settings', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      minimizeToTray: true,
      closeToTray: true,
    });

    expect(merged.closeToTray).toBe(true);
    expect('minimizeToTray' in merged).toBe(false);
  });

  it('merges lyrics settings without dropping untouched display preferences', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      lyrics: {
        showRomaji: true,
        playerOffsetX: 999,
      },
    });

    expect(settingsStore.settings.lyrics.showTranslation).toBe(true);
    expect(settingsStore.settings.lyrics.showRomaji).toBe(true);
    expect(settingsStore.settings.lyrics.playerOffsetX).toBe(30);
  });

  it('merges desktop lyrics settings while keeping the desktop defaults intact', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      desktopLyrics: {
        autoHideWhenFullscreen: false,
        colorScheme: 'pink',
      },
    });

    expect(settingsStore.settings.desktopLyrics.autoHideWhenFullscreen).toBe(false);
    expect(settingsStore.settings.desktopLyrics.colorScheme).toBe('pink');
    expect(settingsStore.settings.desktopLyrics.playerAlignment).toBe('center');
  });
});
