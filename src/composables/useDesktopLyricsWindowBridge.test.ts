import { describe, expect, it, vi } from 'vitest';

import { createDesktopLyricsWindowOptions } from './useDesktopLyricsWindowBridge';

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock('../features/playback/usePlaybackStore', () => ({
  usePlaybackStore: vi.fn(),
}));

vi.mock('../features/settings/store', () => ({
  useSettingsStore: vi.fn(),
}));

vi.mock('../shared/stores/ui', () => ({
  useUiStore: vi.fn(),
}));

vi.mock('./lyrics', () => ({
  useLyrics: vi.fn(),
}));

vi.mock('./player', () => ({
  usePlayer: vi.fn(),
}));

describe('desktop lyrics window bridge', () => {
  it('creates the desktop lyrics window without stealing main window focus', () => {
    expect(createDesktopLyricsWindowOptions({
      alwaysOnTop: true,
      hasStoredBounds: false,
    })).toMatchObject({
      alwaysOnTop: true,
      center: true,
      focus: false,
      focusable: true,
      visible: false,
    });
  });
});
