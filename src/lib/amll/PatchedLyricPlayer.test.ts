import { describe, expect, it } from 'vitest';

import {
  TIMED_ROMAJI_BASE_OPACITY,
  TIMED_ROMAJI_HIGHLIGHT_OPACITY,
  TIMED_ROMAJI_SUBLINE_OPACITY,
  getTimedRomajiFillProgress,
  getTimedRomajiProgress,
  shouldRebuildTimedRomajiDom,
} from './timedRomaji';

describe('shouldRebuildTimedRomajiDom', () => {
  it('rebuilds when AMLL cleared timed romaji spans but left the old signature', () => {
    expect(shouldRebuildTimedRomajiDom('same', 'same', 0, 3)).toBe(true);
  });

  it('keeps existing timed romaji spans when signature and word count still match', () => {
    expect(shouldRebuildTimedRomajiDom('same', 'same', 3, 3)).toBe(false);
  });
});

describe('getTimedRomajiProgress', () => {
  it('returns a continuous progress ratio inside the word time range', () => {
    expect(getTimedRomajiProgress(1500, 1000, 2000)).toBe(0.5);
  });

  it('clamps progress before and after the word time range', () => {
    expect(getTimedRomajiProgress(900, 1000, 2000)).toBe(0);
    expect(getTimedRomajiProgress(2100, 1000, 2000)).toBe(1);
  });
});

describe('getTimedRomajiFillProgress', () => {
  it('clears romaji highlight after the lyric line has ended', () => {
    expect(getTimedRomajiFillProgress(2400, 2500, 1000, 2000)).toBe(1);
    expect(getTimedRomajiFillProgress(2500, 2500, 1000, 2000)).toBe(0);
    expect(getTimedRomajiFillProgress(2600, 2500, 1000, 2000)).toBe(0);
  });
});

describe('timed romaji visual intensity', () => {
  it('keeps highlighted romaji as bright as the main lyric while dimming only the base text', () => {
    expect(TIMED_ROMAJI_SUBLINE_OPACITY).toBe('1');
    expect(TIMED_ROMAJI_BASE_OPACITY).toBe('0.3');
    expect(TIMED_ROMAJI_HIGHLIGHT_OPACITY).toBe('1');
  });
});
