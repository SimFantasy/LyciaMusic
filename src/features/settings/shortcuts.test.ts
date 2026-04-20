import { describe, expect, it } from 'vitest';

import {
  createDefaultShortcutSettings,
  toGlobalShortcutAccelerator,
} from './shortcuts';

describe('shortcut settings helpers', () => {
  it('keeps global shortcuts disabled by default', () => {
    expect(createDefaultShortcutSettings().globalEnabled).toBe(false);
  });

  it('converts shortcut bindings to tauri global accelerators', () => {
    expect(toGlobalShortcutAccelerator({
      code: 'KeyP',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    })).toBe('control+alt+KeyP');

    expect(toGlobalShortcutAccelerator({
      code: 'ArrowLeft',
      ctrl: false,
      alt: false,
      shift: true,
      meta: true,
    })).toBe('shift+super+ArrowLeft');
  });

  it('returns null for empty bindings', () => {
    expect(toGlobalShortcutAccelerator(null)).toBeNull();
  });
});
