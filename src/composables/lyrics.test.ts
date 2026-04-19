import { describe, expect, it } from 'vitest';

describe('lyrics font preset normalization', async () => {
  const { normalizeLyricsFontPreset } = await import('./lyrics');

  it('keeps custom system font names', () => {
    expect(normalizeLyricsFontPreset('Maple Mono NF CN')).toBe('Maple Mono NF CN');
  });

  it('falls back for blank values', () => {
    expect(normalizeLyricsFontPreset('   ')).toBe('system');
  });
});

describe('lyrics display helpers', async () => {
  const {
    getCurrentLyricDisplayLines,
    getDisplaySubtitles,
  } = await import('./lyrics');

  it('orders visible sublines as romaji first and translation second', () => {
    const subtitles = getDisplaySubtitles({
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, true);

    expect(subtitles).toEqual({
      upper: 'so no hi ka ra na ni mo ka mo',
      lower: '从那天开始似乎',
    });
  });

  it('hides romaji by default while keeping translation visible', () => {
    const subtitles = getDisplaySubtitles({
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, false);

    expect(subtitles).toEqual({
      upper: '从那天开始似乎',
      lower: '',
    });
  });

  it('exposes timed romaji words for the secondary display line', () => {
    const displayLines = getCurrentLyricDisplayLines({
      time: 43.802,
      endTime: 46.596,
      text: 'その日から何もかも',
      translation: '从那天开始似乎',
      romaji: 'so no hi ka ra na ni mo ka mo',
      words: [
        { text: 'その', start: 43.802, end: 44.2, romaji: 'so no ' },
        { text: '日から', start: 44.2, end: 45, romaji: 'hi ka ra ' },
        { text: '何もかも', start: 45, end: 46.596, romaji: 'na ni mo ka mo' },
      ],
    }, true, true);

    expect(displayLines.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
    expect(displayLines[1]?.words).toEqual([
      { text: 'so no ', start: 43.802, end: 44.2 },
      { text: 'hi ka ra ', start: 44.2, end: 45 },
      { text: 'na ni mo ka mo', start: 45, end: 46.596 },
    ]);
  });
});

describe('lyrics settings normalization', async () => {
  const {
    MAX_PLAYER_OFFSET_X,
    MIN_PLAYER_OFFSET_Y,
    normalizeDesktopLyricsSettingsPatch,
    normalizeLyricsSettingsPatch,
  } = await import('./lyrics');

  it('clamps player offsets for migrated player settings', () => {
    const normalized = normalizeLyricsSettingsPatch({
      playerOffsetX: 999,
      playerOffsetY: -999,
    });

    expect(normalized.playerOffsetX).toBe(MAX_PLAYER_OFFSET_X);
    expect(normalized.playerOffsetY).toBe(MIN_PLAYER_OFFSET_Y);
  });

  it('defaults desktop auto-hide on fullscreen to enabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenFullscreen).toBe(true);
  });

  it('restores desktop auto-hide on fullscreen from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      autoHideWhenFullscreen: false,
    });

    expect(normalized.autoHideWhenFullscreen).toBe(false);
  });
});
