import { describe, expect, it } from 'vitest';

import source from './App.vue?raw';

describe('App text selection behavior', () => {
  it('prevents browser text selection across the app shell by default', () => {
    expect(source).toContain('html,\nbody,\n#app');
    expect(source).toContain('-webkit-user-select: none;');
    expect(source).toContain('user-select: none;');
  });

  it('keeps editable text controls selectable', () => {
    expect(source).toContain('input,\ntextarea,\n[contenteditable="true"]');
    expect(source).toContain('-webkit-user-select: text;');
    expect(source).toContain('user-select: text;');
  });
});
