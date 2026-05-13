import { describe, expect, it } from 'vitest';

import { convertLyricsToAmlLines, getCurrentLyricDisplayLines } from './converters';
import type { LyricLine } from './types';

describe('convertLyricsToAmlLines', () => {
  it('limits plain lyric lead-in before dense bilingual lines', () => {
    const lines: LyricLine[] = [
      {
        time: 18.11,
        endTime: 19.83,
        text: 'You show me',
        translation: '你告诉我',
        romaji: '',
      },
      {
        time: 19.83,
        endTime: 24.7,
        text: 'what is deep as sea',
        translation: '什么如海般深沉',
        romaji: '',
      },
    ];

    const amlLines = convertLyricsToAmlLines(lines, true, false);

    expect(amlLines[0]?.startTime).toBe(18110);
    expect(amlLines[0]?.endTime).toBe(19530);
    expect(amlLines[1]?.startTime).toBe(19830);
  });

  it('carries independent timed romaji words for player-side karaoke rendering', () => {
    const lines = [
      {
        time: 98.981,
        endTime: 104.179,
        text: '拙い祈りが織りなす波',
        translation: '笨拙的祈愿交织而成汹涌的巨浪',
        romaji: 'tsu ta na i i no ri ga o ri na su na mi',
        words: [
          { text: '拙', start: 98.981, end: 99.565, romaji: '' },
          { text: 'い', start: 99.565, end: 99.837, romaji: '' },
        ],
        romajiWords: [
          { text: 'tsu ', start: 98.981, end: 99.033 },
          { text: 'ta ', start: 99.033, end: 99.521 },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true) as Array<ReturnType<typeof convertLyricsToAmlLines>[number] & {
      romajiWords?: Array<{ text: string; startTime: number; endTime: number }>;
    }>;

    expect(amlLines[0]?.romanLyric).toBe('tsu ta na i i no ri ga o ri na su na mi');
    expect(amlLines[0]?.romajiWords).toEqual([
      { text: 'tsu ', startTime: 98981, endTime: 99033 },
      { text: 'ta ', startTime: 99033, endTime: 99521 },
    ]);
  });

  it('does not render timed romaji as ruby text on the main lyric row', () => {
    const lines = [
      {
        time: 54.353,
        endTime: 59.487,
        text: '本当の世界で笑えるか?',
        translation: '在现实世界里还能够展颜欢笑吗',
        romaji: 'ho n to u no se ka i de wa ra e ru ka',
        words: [
          { text: '本', start: 54.664, end: 54.944, romaji: 'ho n ' },
          { text: '当', start: 54.944, end: 54.981, romaji: 'to u ' },
          { text: 'の', start: 54.981, end: 55.597, romaji: 'no ' },
        ],
        romajiWords: [
          { text: 'ho ', start: 54.353, end: 54.508 },
          { text: 'n ', start: 54.508, end: 54.663 },
          { text: 'to ', start: 54.664, end: 54.803 },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('ho n to u no se ka i de wa ra e ru ka');
    expect(amlLines[0]?.words.map((word) => word.romanWord)).toEqual(['', '', '']);
  });

  it('uses independent timed romaji words for the current romaji display line', () => {
    const displayLines = getCurrentLyricDisplayLines({
      time: 98.981,
      endTime: 104.179,
      text: '拙い祈りが織りなす波',
      translation: '笨拙的祈愿交织而成汹涌的巨浪',
      romaji: 'tsu ta na i',
      words: [
        { text: '拙', start: 98.981, end: 99.565, romaji: '' },
      ],
      romajiWords: [
        { text: 'tsu ', start: 98.981, end: 99.033 },
        { text: 'ta ', start: 99.033, end: 99.521 },
      ],
    }, true, true);

    expect(displayLines[1]?.kind).toBe('romaji');
    expect(displayLines[1]?.words).toEqual([
      { text: 'tsu ', start: 98.981, end: 99.033 },
      { text: 'ta ', start: 99.033, end: 99.521 },
    ]);
  });
});
