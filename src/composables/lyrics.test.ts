import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

describe('normalizeEslrcSource', async () => {
  const { normalizeEslrcSource } = await import('./lyrics');

  it('keeps valid inline timestamps untouched', () => {
    const input = '[00:07.310]A[00:07.520]B[00:07.780]C[00:07.890]D[00:08.450]E[00:08.650]';

    expect(normalizeEslrcSource(input)).toBe(input);
  });

  it('preserves empty timing gaps before a word with an invisible placeholder', () => {
    const input = '[00:07.545]A[00:07.721][00:07.722]B[00:07.852][00:07.853]C[00:08.022]';

    expect(normalizeEslrcSource(input)).toBe('[00:07.545]A[00:07.721]\u2063[00:07.722]B[00:07.852]\u2063[00:07.853]C[00:08.022]');
  });
});

describe('lyrics font preset normalization', async () => {
  const { normalizeLyricsFontPreset } = await import('./lyrics');

  it('keeps custom system font names', () => {
    expect(normalizeLyricsFontPreset('Maple Mono NF CN')).toBe('Maple Mono NF CN');
  });

  it('falls back for blank values', () => {
    expect(normalizeLyricsFontPreset('   ')).toBe('system');
  });
});

describe('enhanced lrc parser', async () => {
  const {
    isEnhancedLrcLine,
    mergeEnhancedLinesIntoBaseLines,
    parseEnhancedLrc,
    parseEnhancedLrcLine,
    parseTimestampToMs,
  } = await import('./lyrics');

  it('parses enhanced timestamp strings to milliseconds', () => {
    expect(parseTimestampToMs('00:36.111')).toBe(36111);
    expect(parseTimestampToMs('01:02.3')).toBe(62300);
    expect(parseTimestampToMs('bad')).toBeNull();
  });

  it('detects enhanced lrc lines by angle-bracket timestamps', () => {
    expect(isEnhancedLrcLine('[00:36.111]<00:36.111>A<00:36.551>B<00:37.111>')).toBe(true);
    expect(isEnhancedLrcLine('[00:36.111]plain line')).toBe(false);
    expect(isEnhancedLrcLine('[ar:Artist]')).toBe(false);
  });

  it('parses a standard enhanced lrc line into words and line timing', () => {
    const parsed = parseEnhancedLrcLine('[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>C<00:37.421>');

    expect(parsed).not.toBeNull();
    expect(parsed?.startTime).toBe(36111);
    expect(parsed?.endTime).toBe(37421);
    expect(parsed?.words.map((word) => ({
      text: word.word,
      start: word.startTime,
      end: word.endTime,
    }))).toEqual([
      { text: 'A', start: 36111, end: 36551 },
      { text: 'B', start: 36551, end: 36991 },
      { text: 'C', start: 36991, end: 37421 },
    ]);
  });

  it('allows line start time and first word time to differ', () => {
    const parsed = parseEnhancedLrcLine('[00:36.000]<00:36.111>Lead<00:36.551>In<00:36.991>');

    expect(parsed).not.toBeNull();
    expect(parsed?.startTime).toBe(36000);
    expect(parsed?.words[0].startTime).toBe(36111);
    expect(parsed?.endTime).toBe(36991);
  });

  it('supports spaces and punctuation inside enhanced word text', () => {
    const parsed = parseEnhancedLrcLine(`[00:19.960]<00:19.960>Composer:<00:21.292> Yang<00:22.624>${'\uFF1A'}<00:23.956> OK<00:25.288>!<00:26.620>`);

    expect(parsed).not.toBeNull();
    expect(parsed?.words.map((word) => word.word)).toEqual([
      'Composer:',
      ' Yang',
      '\uFF1A',
      ' OK',
      '!',
    ]);
  });

  it('skips zero-length segments created by consecutive enhanced timestamps', () => {
    const parsed = parseEnhancedLrcLine('[00:00.000]<00:00.000>ma<00:00.100><00:00.101>ga<00:00.200><00:00.201>shi<00:00.300>');

    expect(parsed).not.toBeNull();
    expect(parsed?.words.map((word) => ({
      text: word.word,
      start: word.startTime,
      end: word.endTime,
    }))).toEqual([
      { text: 'ma', start: 0, end: 100 },
      { text: 'ga', start: 101, end: 200 },
      { text: 'shi', start: 201, end: 300 },
    ]);
  });

  it('falls back on malformed enhanced lines while preserving valid enhanced lines', () => {
    const parsed = parseEnhancedLrc([
      '[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>',
      '[00:40.000]<00:40.000>Broken<00:40.500>Line',
      '[00:41.000]plain line',
    ].join('\n'));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].startTime).toBe(36111);
  });

  it('merges enhanced lines into a plain lrc baseline without dropping ordinary lines', () => {
    const enhancedLines = parseEnhancedLrc('[00:10.000]<00:10.000>A<00:10.500>B<00:11.000>');
    const baseLines = [
      {
        words: [{
          startTime: 10000,
          endTime: 11000,
          word: '<00:10.000>A<00:10.500>B<00:11.000>',
          romanWord: '',
        }],
        translatedLyric: '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
        startTime: 10000,
        endTime: 11000,
      },
      {
        words: [{
          startTime: 12000,
          endTime: 13000,
          word: 'Plain line',
          romanWord: '',
        }],
        translatedLyric: '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
        startTime: 12000,
        endTime: 13000,
      },
    ];

    const merged = mergeEnhancedLinesIntoBaseLines(enhancedLines, baseLines);

    expect(merged).toHaveLength(2);
    expect(merged[0].words.map((word) => word.word)).toEqual(['A', 'B']);
    expect(merged[1].words[0]?.word).toBe('Plain line');
  });
});

describe('mergePreparedLines', async () => {
  const {
    getCurrentLyricDisplayLines,
    getDisplaySubtitles,
    getLineScriptProfile,
    mergePreparedLines,
  } = await import('./lyrics');

  it('keeps the earlier source line as the main line for bilingual groups', () => {
    const merged = mergePreparedLines([
      {
        startMs: 35308,
        endMs: 45395,
        text: 'I sit by myself talking to the moon',
        translation: '',
        romaji: '',
        words: [{
          text: 'I sit by myself talking to the moon',
          start: 35.308,
          end: 45.395,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 35308,
        endMs: 45390,
        text: '\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0',
        translation: '',
        romaji: '',
        words: [{
          text: '\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0',
          start: 35.308,
          end: 45.39,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('I sit by myself talking to the moon');
    expect(merged[0].translation).toBe('\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0');
  });

  it('still prefers explicit translation-bearing lines as the main carrier', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 3000,
        text: 'Main',
        translation: '\u526f\u884c',
        romaji: '',
        words: [{
          text: 'Main',
          start: 1,
          end: 3,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 1000,
        endMs: 2990,
        text: 'Alt',
        translation: '',
        romaji: '',
        words: [{
          text: 'Alt',
          start: 1,
          end: 2.99,
          romaji: '',
        }],
        sourceIndex: 0,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('Main');
    expect(merged[0].translation).toBe('\u526f\u884c');
  });

  it('classifies japanese lyric groups by content instead of source order', () => {
    const merged = mergePreparedLines([
      {
        startMs: 43802,
        endMs: 46596,
        text: 'so no hi ka ra na ni mo ka mo',
        translation: '',
        romaji: '',
        words: [{
          text: 'so no hi ka ra na ni mo ka mo',
          start: 43.802,
          end: 46.596,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 43802,
        endMs: 46596,
        text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
        translation: '',
        romaji: '',
        words: [{
          text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
          start: 43.802,
          end: 46.596,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 43802,
        endMs: 46844,
        text: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
          start: 43.802,
          end: 46.844,
          romaji: '',
        }],
        sourceIndex: 2,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082');
    expect(merged[0].translation).toBe('\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e');
    expect(merged[0].romaji).toBe('so no hi ka ra na ni mo ka mo');
    expect(merged[0].words?.[0]?.romaji).toBe('so no hi ka ra na ni mo ka mo');
  });

  it('keeps english bilingual groups stable without treating english as romaji', () => {
    const merged = mergePreparedLines([
      {
        startMs: 24139,
        endMs: 26668,
        text: 'You are all I had',
        translation: '',
        romaji: '',
        words: [{
          text: 'You are all I had',
          start: 24.139,
          end: 26.668,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 24139,
        endMs: 28900,
        text: '\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207',
          start: 24.139,
          end: 28.9,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('You are all I had');
    expect(merged[0].translation).toBe('\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207');
    expect(merged[0].romaji).toBe('');
  });

  it('classifies korean lyric groups as main plus chinese translation', () => {
    const merged = mergePreparedLines([
      {
        startMs: 12000,
        endMs: 15000,
        text: '\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0',
        translation: '',
        romaji: '',
        words: [{
          text: '\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0',
          start: 12,
          end: 15,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 12000,
        endMs: 15000,
        text: '\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728',
        translation: '',
        romaji: '',
        words: [{
          text: '\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728',
          start: 12,
          end: 15,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0');
    expect(merged[0].translation).toBe('\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728');
    expect(merged[0].romaji).toBe('');
  });

  it('treats chinese plus pinyin as main and romaji', () => {
    const merged = mergePreparedLines([
      {
        startMs: 5000,
        endMs: 8000,
        text: '\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6',
        translation: '',
        romaji: '',
        words: [{
          text: '\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6',
          start: 5,
          end: 8,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 5000,
        endMs: 8000,
        text: 'xin li you yi ge meng',
        translation: '',
        romaji: '',
        words: [{
          text: 'xin li you yi ge meng',
          start: 5,
          end: 8,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6');
    expect(merged[0].translation).toBe('');
    expect(merged[0].romaji).toBe('xin li you yi ge meng');
  });

  it('keeps enhanced main-word timing while attaching a translated line', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 2400,
        text: 'Hello',
        translation: '',
        romaji: '',
        words: [
          { text: 'Hel', start: 1, end: 1.7, romaji: '' },
          { text: 'lo', start: 1.7, end: 2.4, romaji: '' },
        ],
        sourceIndex: 0,
      },
      {
        startMs: 1000,
        endMs: 2400,
        text: '\u4f60\u597d',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u597d',
          start: 1,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].translation).toBe('\u4f60\u597d');
    expect(merged[0].words).toEqual([
      { text: 'Hel', start: 1, end: 1.7, romaji: '' },
      { text: 'lo', start: 1.7, end: 2.4, romaji: '' },
    ]);
  });

  it('merges bilingual lines with tiny timestamp drift but not beyond the safety cap', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 2400,
        text: 'Main line',
        translation: '',
        romaji: '',
        words: [{
          text: 'Main line',
          start: 1,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 1004,
        endMs: 2400,
        text: '\u526f\u884c',
        translation: '',
        romaji: '',
        words: [{
          text: '\u526f\u884c',
          start: 1.004,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 5000,
        endMs: 6400,
        text: 'Next sentence',
        translation: '',
        romaji: '',
        words: [{
          text: 'Next sentence',
          start: 5,
          end: 6.4,
          romaji: '',
        }],
        sourceIndex: 2,
      },
      {
        startMs: 7000,
        endMs: 8200,
        text: 'Standalone',
        translation: '',
        romaji: '',
        words: [{
          text: 'Standalone',
          start: 7,
          end: 8.2,
          romaji: '',
        }],
        sourceIndex: 3,
      },
      {
        startMs: 7065,
        endMs: 8200,
        text: '\u4e0d\u5e94\u8be5\u5408\u5e76',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4e0d\u5e94\u8be5\u5408\u5e76',
          start: 7.065,
          end: 8.2,
          romaji: '',
        }],
        sourceIndex: 4,
      },
      {
        startMs: 12000,
        endMs: 13200,
        text: 'Afterward',
        translation: '',
        romaji: '',
        words: [{
          text: 'Afterward',
          start: 12,
          end: 13.2,
          romaji: '',
        }],
        sourceIndex: 5,
      },
    ]);

    expect(merged[0].translation).toBe('\u526f\u884c');
    expect(merged.map((line) => line.text)).toEqual([
      'Main line',
      'Next sentence',
      'Standalone',
      '\u4e0d\u5e94\u8be5\u5408\u5e76',
      'Afterward',
    ]);
  });

  it('does not merge rapid same-script lines in dense sequences', () => {
    const merged = mergePreparedLines([
      {
        startMs: 0,
        endMs: 200,
        text: 'one',
        translation: '',
        romaji: '',
        words: [{ text: 'one', start: 0, end: 0.2, romaji: '' }],
        sourceIndex: 0,
      },
      {
        startMs: 40,
        endMs: 240,
        text: 'two',
        translation: '',
        romaji: '',
        words: [{ text: 'two', start: 0.04, end: 0.24, romaji: '' }],
        sourceIndex: 1,
      },
      {
        startMs: 85,
        endMs: 260,
        text: 'three',
        translation: '',
        romaji: '',
        words: [{ text: 'three', start: 0.085, end: 0.26, romaji: '' }],
        sourceIndex: 2,
      },
    ]);

    expect(merged.map((line) => line.text)).toEqual(['one', 'two', 'three']);
  });

  it('falls back to secondary lines when same-script groups are ambiguous', () => {
    const merged = mergePreparedLines([
      {
        startMs: 2000,
        endMs: 4000,
        text: '\u6211\u4eec\u8fd8\u5728\u8fd9\u91cc',
        translation: '',
        romaji: '',
        words: [{
          text: '\u6211\u4eec\u8fd8\u5728\u8fd9\u91cc',
          start: 2,
          end: 4,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 2000,
        endMs: 4000,
        text: '\u540c\u6b65\u7684\u53e6\u4e00\u884c',
        translation: '',
        romaji: '',
        words: [{
          text: '\u540c\u6b65\u7684\u53e6\u4e00\u884c',
          start: 2,
          end: 4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].translation).toBe('');
    expect(merged[0].romaji).toBe('');
    expect(merged[0].secondary).toEqual(['\u540c\u6b65\u7684\u53e6\u4e00\u884c']);
  });

  it('detects hangul characters when building the script profile', () => {
    const profile = getLineScriptProfile('\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0');

    expect(profile.hangulCount).toBeGreaterThan(0);
    expect(profile.dominantScript).toBe('hangul');
  });

  it('orders visible sublines as romaji first and translation second', () => {
    const subtitles = getDisplaySubtitles({
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, true);

    expect(subtitles).toEqual({
      upper: 'so no hi ka ra na ni mo ka mo',
      lower: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
    });
  });

  it('hides romaji by default while keeping translation visible', () => {
    const subtitles = getDisplaySubtitles({
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, false);

    expect(subtitles).toEqual({
      upper: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      lower: '',
    });
  });

  it('exposes timed romaji words for the secondary display line', () => {
    const displayLines = getCurrentLyricDisplayLines({
      time: 43.802,
      endTime: 46.596,
      text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
      words: [
        { text: '\u305d\u306e', start: 43.802, end: 44.2, romaji: 'so no ' },
        { text: '\u65e5\u304b\u3089', start: 44.2, end: 45, romaji: 'hi ka ra ' },
        { text: '\u4f55\u3082\u304b\u3082', start: 45, end: 46.596, romaji: 'na ni mo ka mo' },
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
