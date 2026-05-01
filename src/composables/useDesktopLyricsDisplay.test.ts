import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useDesktopLyricsDisplay } from './useDesktopLyricsDisplay';
import type { DesktopLyricsStatePayload } from '../features/desktopLyrics/shared';

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
}));

function createPayload(enableWordEffect: boolean): DesktopLyricsStatePayload {
  return {
    song: null,
    parsedLyrics: [{
      time: 1,
      endTime: 5,
      text: 'hello world',
      translation: '',
      romaji: '',
      words: [
        { text: 'hello ', start: 1, end: 3, romaji: '' },
        { text: 'world', start: 3, end: 5, romaji: '' },
      ],
    }],
    lyricsStatus: 'ready',
    fallbackText: 'Instrumental / No lyrics',
    playbackTime: 2,
    syncedAt: Date.now(),
    isPlaying: false,
    audioDelay: 0,
    themeColors: [],
    settings: {
      showTranslation: true,
      showRomaji: false,
      isAlwaysOnTop: false,
      alwaysShowShadowBackground: false,
      autoHideWhenFullscreen: true,
      showDoubleLine: false,
      enableWordEffect,
      isLocked: false,
      persistLock: false,
      colorScheme: 'auto',
      customPlayedColor: '#EC4141',
      customUnplayedColor: '#FFFFFF',
      customRomajiColor: '#BFDBFE',
      customTranslationColor: '#FBCFE8',
      playerFontScale: 1,
      playerLineGap: 1,
      playerOffsetX: 0,
      playerOffsetY: 0,
      playerAlignment: 'center',
      playerFontPreset: 'system',
    },
  };
}

describe('useDesktopLyricsDisplay', () => {
  it('renders the main line as one text block when desktop word effect is disabled', () => {
    const display = useDesktopLyricsDisplay(ref(false));

    display.handlePayload(createPayload(false));

    expect(display.visibleLyricLines.value[0]?.line.text).toBe('hello world');
    expect(display.visibleLyricLines.value[0]?.words).toEqual([]);
  });
});
