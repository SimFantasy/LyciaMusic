import { describe, expect, it } from 'vitest';

import source from './SongInfoModal.vue?raw';

describe('SongInfoModal window drag area', () => {
  it('keeps a Tauri drag region available above the dialog panels', () => {
    expect(source).toContain('song-info-window-drag-strip');
    expect(source).toContain('data-tauri-drag-region');
  });
});

describe('SongInfoModal lyrics editor theme', () => {
  it('defines dark surface tokens for the lyrics editor panel', () => {
    expect(source).toContain('--lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);');
    expect(source).toContain("isDarkTheme ? 'song-info-stage--dark' : ''");
    expect(source).toContain('.song-info-stage--dark');
    expect(source).toContain('--lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);');
    expect(source).toContain('--lyrics-editor-actions-bg: rgba(15, 23, 42, 0.96);');
  });

  it('keeps dark editor selectors local to the modal instead of compiling to global .dark rules', () => {
    expect(source).not.toContain(':global(.dark) .song-info-stage');
    expect(source).not.toContain(':global(.dark) .lyrics-editor-expand-button');
    expect(source).not.toContain(':global(.dark) .modal-action-button');
  });
});
