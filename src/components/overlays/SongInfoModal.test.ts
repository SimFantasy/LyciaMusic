import { describe, expect, it } from 'vitest';

import source from './SongInfoModal.vue?raw';

describe('SongInfoModal window drag area', () => {
  it('keeps a Tauri drag region available above the dialog panels', () => {
    expect(source).toContain('song-info-window-drag-strip');
    expect(source).toContain('data-tauri-drag-region');
  });
});
