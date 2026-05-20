import { describe, expect, it } from 'vitest';

import source from './AmlLyricPlayer.vue?raw';

describe('AmlLyricPlayer playback pausing', () => {
  it('freezes word animations without switching AMLL into its global paused layout', () => {
    expect(source).toContain('player.setPlaybackPaused(!props.playing);');
    expect(source).not.toContain('player.pause();');
    expect(source).not.toContain('player.resume();');
  });
});
