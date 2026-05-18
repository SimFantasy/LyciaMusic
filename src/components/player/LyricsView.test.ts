import { describe, expect, it } from 'vitest';

import source from './LyricsView.vue?raw';

describe('LyricsView custom font import', () => {
  it('applies an imported font in the same settings patch that stores it', () => {
    expect(source).toContain('lyrics: { playerFontPreset: importedFont.family }');
    expect(source).toContain('desktopLyrics: { playerFontPreset: importedFont.family }');
  });

  it('renders separate top-level triggers for system and custom font presets', () => {
    expect(source).toContain('systemFontOptions');
    expect(source).toContain('customFontOptions');
    expect(source).toContain('systemFontPresetTriggerRef');
    expect(source).toContain('customFontPresetTriggerRef');
    expect(source).toContain('toggleFontPresetMenu(\'system\')');
    expect(source).toContain('toggleFontPresetMenu(\'custom\')');
  });

  it('keeps system and custom font lists in their own menus', () => {
    expect(source).toContain('fontPresetMenuMode === \'system\'');
    expect(source).toContain('fontPresetMenuMode === \'custom\'');
    expect(source).toContain('v-for="option in systemFontOptions"');
    expect(source).toContain('v-for="option in customFontOptions"');
  });

  it('uses a shrinking label container so long font names do not cover trailing actions', () => {
    expect(source).toContain('min-w-0 flex-1');
    expect(source).toContain('truncate');
    expect(source).toContain(':title="option.label"');
  });

  it('uses a delete icon for custom font removal without selecting the row', () => {
    expect(source).toContain('Trash2');
    expect(source).toContain('removeCustomLyricsFont(option.value)');
    expect(source).toContain('@click.stop');
  });

  it('rebuilds the lyrics layout after imported fonts finish registering', () => {
    expect(source).toContain('importedLyricsFontsRevision');
    expect(source).toContain('lyricsLayoutVersion');
    expect(source).toContain(':layout-version="lyricsLayoutVersion"');
  });
});
