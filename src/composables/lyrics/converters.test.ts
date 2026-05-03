import { describe, expect, it } from 'vitest';

import { convertLyricsToAmlLines } from './converters';
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
});
