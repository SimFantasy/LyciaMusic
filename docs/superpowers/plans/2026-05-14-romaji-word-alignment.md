# Romaji Word Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render complete Japanese romaji alignment as centered per-word stacks in both the main AMLL player and desktop lyrics, with whole-line romaji fallback when alignment is incomplete.

**Architecture:** Keep `LyricWord.romaji` as the shared contract. Tighten classifier/converter logic so per-word romaji is only trusted when every main word has a non-empty romaji value, then add a desktop-specific word-stack render path that uses the same complete-match rule.

**Tech Stack:** Vue 3, TypeScript, Vitest, AMLL `@applemusic-like-lyrics/core`, existing lyrics composables.

---

## Pre-Flight

The workspace currently has unrelated or pre-existing modified lyrics files. Before implementation, inspect and preserve those changes:

```bash
git status --short
git diff -- src/components/player/LyricsView.vue src/composables/lyrics.test.ts src/composables/lyrics/classifier.ts src/composables/lyrics/converters.test.ts src/composables/lyrics/converters.ts
```

Expected: the command may show existing edits in the listed files. Do not reset or discard them. Apply changes on top of the current file contents.

## File Structure

- Modify `src/composables/lyrics/classifier.ts`: make roman-word merging conservative; return per-word roman data only when every main word receives romaji.
- Modify `src/composables/lyrics/converters.ts`: add or reuse a complete-romaji helper, ensure AMLL emits `romanWord` only on full coverage and falls back to `romanLyric` otherwise.
- Modify `src/composables/lyrics/converters.test.ts`: add focused converter fallback coverage.
- Modify `src/composables/lyrics.test.ts`: keep or add integration coverage for the provided Japanese sample and full AMLL per-word output.
- Modify `src/composables/useDesktopLyricsDisplay.ts`: expose per-line desktop word-romaji alignment state and suppress romaji secondary lines when word stacks are active.
- Modify `src/composables/useDesktopLyricsDisplay.test.ts`: cover desktop word-romaji state and fallback behavior.
- Modify `src/components/player/DesktopLyricsWindow.vue`: render active desktop words as main-text + romaji stacks when the display line is alignable.

## Task 1: Conservative Per-Word Romaji Contract

**Files:**
- Modify: `src/composables/lyrics/classifier.ts`
- Test: `src/composables/lyrics.test.ts`

- [ ] **Step 1: Write the failing integration test for incomplete matching**

Add this test inside `describe('raw lyrics samples from the common formats checklist', async () => { ... })` in `src/composables/lyrics.test.ts`, near the existing Japanese romaji tests:

```ts
  it('falls back to whole-line romaji when timed romaji cannot cover every Japanese word', async () => {
    const lines = await parseRawToLyricLines([
      '[00:12.651]<00:12.651>ka <00:12.884>yo <00:13.267>wa <00:13.476>i <00:13.678>hi <00:14.126>ka <00:14.543>ri <00:18.056>',
      '[00:12.651]<00:12.651>か<00:12.884>弱<00:13.476>い<00:13.678>光<00:14.553>が<00:14.897>指<00:15.616>差<00:16.936>す<00:17.007>先<00:18.056>',
      '[00:12.651]<00:12.651>追寻着那道微弱光线所指的方向<00:18.920>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.romaji).toBe('ka yo wa i hi ka ri');
    expect(lines[0]?.words?.map((word) => normalizeWhitespace(word.romaji || ''))).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);

    const amlLines = convertLyricsToAmlLines(lines, true, true);
    expect(amlLines[0]?.romanLyric).toBe('ka yo wa i hi ka ri');
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/composables/lyrics.test.ts -t "falls back to whole-line romaji when timed romaji cannot cover every Japanese word"
```

Expected: FAIL because current merging may keep partial `word.romaji` values instead of clearing all per-word romaji for incomplete alignment.

- [ ] **Step 3: Implement conservative merging**

In `src/composables/lyrics/classifier.ts`, update `mergeAlignedRomanWords` so the final return requires every main word to have non-empty roman text. Keep existing exact-count aligned behavior, but normalize text before returning.

Use this shape for the helper and final guard:

```ts
function normalizeRomanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
```

Inside `mergeAlignedRomanWords`, when `mainWords.some((word) => word.romanText)` is true, build all main-word entries first:

```ts
    const nativeRomanWords = mainWords.map((word) => ({
      text: normalizeRomanText(word.romanText || ''),
      startMs: word.startMs,
      endMs: word.endMs,
    }));

    return nativeRomanWords.every((word) => word.text.length > 0)
      ? nativeRomanWords
      : undefined;
```

When `mainWords.length === romajiWords.length && allAligned`, normalize and require full coverage:

```ts
    const alignedRomanWords = romajiWords.map((word) => ({
      text: normalizeRomanText(word.text),
      startMs: word.startMs,
      endMs: word.endMs,
    }));

    return alignedRomanWords.every((word) => word.text.length > 0)
      ? alignedRomanWords
      : undefined;
```

For the overlap-based merge, replace the existing partial return with:

```ts
  const mergedRomanWords = mainWords.map((word, index) => ({
    text: normalizeRomanText(mergedTexts[index]),
    startMs: word.startMs,
    endMs: word.endMs,
  }));

  return mergedRomanWords.every((word) => word.text.length > 0)
    ? mergedRomanWords
    : undefined;
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- src/composables/lyrics.test.ts -t "falls back to whole-line romaji when timed romaji cannot cover every Japanese word"
```

Expected: PASS.

- [ ] **Step 5: Run existing sample alignment test**

Run:

```bash
npm test -- src/composables/lyrics.test.ts -t "aligns romaji fragments with Japanese words that contain multiple syllables"
```

Expected: PASS and the sample maps `弱 -> yo wa`, `光 -> hi ka ri`, `指 -> yu bi`, `先 -> sa ki`.

## Task 2: Main Player Converter Fallback Rule

**Files:**
- Modify: `src/composables/lyrics/converters.ts`
- Test: `src/composables/lyrics/converters.test.ts`

- [ ] **Step 1: Write the failing converter fallback test**

Add this test in `describe('convertLyricsToAmlLines', () => { ... })` in `src/composables/lyrics/converters.test.ts`:

```ts
  it('falls back to line-level roman lyric when any main word is missing romaji', () => {
    const lines = [
      {
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い光が指差す先',
        translation: '追寻着那道微弱光线所指的方向',
        romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: 'yo wa' },
          { text: 'い', start: 13.476, end: 13.678, romaji: '' },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('ka yo wa i hi ka ri ga yu bi sa su sa ki');
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual(['', '', '']);
  });
```

- [ ] **Step 2: Run the converter fallback test to verify it fails**

Run:

```bash
npm test -- src/composables/lyrics/converters.test.ts -t "falls back to line-level roman lyric when any main word is missing romaji"
```

Expected: FAIL if current code only checks the wrong subset of words or leaks partial roman words.

- [ ] **Step 3: Implement a shared complete-romaji predicate in converters**

In `src/composables/lyrics/converters.ts`, add this helper near the top-level converter helpers:

```ts
function hasCompleteWordRomaji(words: LyricWord[] | undefined): words is LyricWord[] {
  return Boolean(words && words.length > 0)
    && words!.every((word) => word.text.trim().length > 0 && Boolean(word.romaji && word.romaji.trim().length > 0));
}
```

Then replace the existing `canRenderAlignedRomaji` expression with:

```ts
    const canRenderAlignedRomaji = showRomaji && hasCompleteWordRomaji(line.words);
```

Keep the existing `romanWord` assignment:

```ts
        romanWord: showRomaji && canRenderAlignedRomaji ? (word.romaji || '').trim() : '',
```

Keep `romanLyric` as:

```ts
      romanLyric: showRomaji && !hasTimedRomaji ? (renderLine.roman?.[0]?.text || '') : '',
```

- [ ] **Step 4: Run converter tests**

Run:

```bash
npm test -- src/composables/lyrics/converters.test.ts
```

Expected: PASS.

## Task 3: Desktop Display State For Word Romaji

**Files:**
- Modify: `src/composables/useDesktopLyricsDisplay.ts`
- Test: `src/composables/useDesktopLyricsDisplay.test.ts`

- [ ] **Step 1: Write the failing desktop state tests**

Add these tests in `describe('useDesktopLyricsDisplay', () => { ... })` in `src/composables/useDesktopLyricsDisplay.test.ts`:

```ts
  it('uses word-level romaji on desktop only when every displayed word has romaji', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い光が指差す先',
        translation: '追寻着那道微弱光线所指的方向',
        romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: 'yo wa' },
          { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
        ],
      }],
      settings: {
        ...payload.settings,
        showRomaji: true,
        showTranslation: true,
      },
    });

    expect(display.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(true);
    expect(display.visibleLyricLines.value[0]?.secondaryLines).toEqual([
      { kind: 'translation', text: '追寻着那道微弱光线所指的方向' },
    ]);
  });

  it('falls back to a desktop romaji secondary line when word romaji is incomplete', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い',
        translation: '微弱',
        romaji: 'ka yo wa i',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: '' },
          { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
        ],
      }],
      settings: {
        ...payload.settings,
        showRomaji: true,
        showTranslation: true,
      },
    });

    expect(display.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(false);
    expect(display.visibleLyricLines.value[0]?.secondaryLines).toEqual([
      { kind: 'romaji', text: 'ka yo wa i' },
      { kind: 'translation', text: '微弱' },
    ]);
  });
```

- [ ] **Step 2: Run desktop state tests to verify they fail**

Run:

```bash
npm test -- src/composables/useDesktopLyricsDisplay.test.ts -t "desktop"
```

Expected: FAIL because `hasAlignedRomaji` does not exist and romaji is still always returned as a secondary line.

- [ ] **Step 3: Add desktop complete-romaji state**

In `src/composables/useDesktopLyricsDisplay.ts`, update the display line interface:

```ts
interface DesktopLyricDisplayLine {
  line: LyricLine;
  lineIndex: number;
  active: boolean;
  words: LyricWord[];
  hasAlignedRomaji: boolean;
  secondaryLines: DesktopLyricSecondaryLine[];
}
```

Add helpers near `getSecondaryLines`:

```ts
function hasCompleteWordRomaji(words: LyricWord[]): boolean {
  return words.length > 0
    && words.every((word) => word.text.trim().length > 0 && Boolean(word.romaji && word.romaji.trim().length > 0));
}

function getSecondaryLines(line: LyricLine, hasAlignedRomaji: boolean): DesktopLyricSecondaryLine[] {
  const secondary: DesktopLyricSecondaryLine[] = [];
  if (settings.value.showRomaji && line.romaji && !hasAlignedRomaji) {
    secondary.push({ kind: 'romaji', text: line.romaji });
  }
  if (settings.value.showTranslation && line.translation) {
    secondary.push({ kind: 'translation', text: line.translation });
  }
  return secondary;
}
```

Replace the old `getSecondaryLines(line: LyricLine)` function with this version.

In `visibleLyricLines`, compute words once and pass the complete-match flag:

```ts
      const words = getMainDisplayWords(line, lineIndex);
      const hasAlignedRomaji = settings.value.showRomaji && hasCompleteWordRomaji(words);

      lines.push({
        line,
        lineIndex,
        active: activeLyricIndex.value >= 0 ? lineIndex === activeLyricIndex.value : lineIndex === 0,
        words,
        hasAlignedRomaji,
        secondaryLines: getSecondaryLines(line, hasAlignedRomaji),
      });
```

- [ ] **Step 4: Run desktop display state tests**

Run:

```bash
npm test -- src/composables/useDesktopLyricsDisplay.test.ts
```

Expected: PASS.

## Task 4: Desktop Word Stack Rendering

**Files:**
- Modify: `src/components/player/DesktopLyricsWindow.vue`
- Test: `src/composables/useDesktopLyricsDisplay.test.ts`

- [ ] **Step 1: Add a render-state test that protects romaji from secondary output**

If Task 3 tests are already present and passing, this step is covered. Run:

```bash
npm test -- src/composables/useDesktopLyricsDisplay.test.ts -t "uses word-level romaji on desktop only when every displayed word has romaji"
```

Expected: PASS before changing Vue markup. This protects the data contract the template will consume.

- [ ] **Step 2: Update desktop word template**

In `src/components/player/DesktopLyricsWindow.vue`, replace the current word span inside:

```vue
<span
  v-for="(word, index) in displayLine.words"
  :key="`${word.start}-${word.end}-${index}`"
  class="desktop-lyric-word"
  :style="displayLine.active ? getWordStyle(word.start, word.end) : undefined"
>
  {{ word.text }}
</span>
```

with:

```vue
<span
  v-for="(word, index) in displayLine.words"
  :key="`${word.start}-${word.end}-${index}`"
  class="desktop-lyric-word"
  :class="{ 'desktop-lyric-word--with-romaji': displayLine.hasAlignedRomaji }"
>
  <span
    class="desktop-lyric-word-main"
    :style="displayLine.active ? getWordStyle(word.start, word.end) : undefined"
  >
    {{ word.text }}
  </span>
  <span
    v-if="displayLine.hasAlignedRomaji"
    class="desktop-lyric-word-romaji"
  >
    {{ word.romaji?.trim() }}
  </span>
</span>
```

- [ ] **Step 3: Update desktop word CSS**

In the same file, replace `.desktop-lyric-word` with:

```css
.desktop-lyric-word {
  display: inline-block;
  white-space: pre-wrap;
  transition:
    color 420ms ease,
    opacity 420ms ease,
    filter 260ms linear,
    text-shadow 260ms linear;
}

.desktop-lyric-word--with-romaji {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  text-align: center;
  vertical-align: bottom;
  white-space: nowrap;
}

.desktop-lyric-word-main {
  display: inline-block;
  white-space: pre-wrap;
}

.desktop-lyric-word-romaji {
  display: block;
  margin-top: 0.08em;
  color: var(--desktop-romaji-color);
  font-size: 0.46em;
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: 0;
  white-space: pre;
  text-shadow:
    0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)),
    0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86)),
    0 0 16px color-mix(in srgb, var(--desktop-romaji-color) 20%, transparent);
}
```

Keep `.desktop-lyric-sub--romaji` unchanged for fallback whole-line romaji.

- [ ] **Step 4: Run typecheck for template type safety**

Run:

```bash
npm run typecheck
```

Expected: PASS. If it fails because `hasAlignedRomaji` is not visible in the template type, confirm the interface in `useDesktopLyricsDisplay.ts` includes the property and the returned computed value uses that interface.

## Task 5: Full Verification And Commit

**Files:**
- Verify all modified implementation and test files.

- [ ] **Step 1: Run focused lyrics tests**

Run:

```bash
npm test -- src/composables/lyrics.test.ts src/composables/lyrics/converters.test.ts src/composables/useDesktopLyricsDisplay.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full frontend checks**

Run:

```bash
npm test
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff -- src/composables/lyrics.test.ts src/composables/lyrics/classifier.ts src/composables/lyrics/converters.test.ts src/composables/lyrics/converters.ts src/composables/useDesktopLyricsDisplay.test.ts src/composables/useDesktopLyricsDisplay.ts src/components/player/DesktopLyricsWindow.vue
```

Expected: diff only implements conservative romaji alignment and desktop word-stack rendering. No unrelated refactors.

- [ ] **Step 4: Commit implementation**

Only stage the files changed for this feature:

```bash
git add src/composables/lyrics.test.ts src/composables/lyrics/classifier.ts src/composables/lyrics/converters.test.ts src/composables/lyrics/converters.ts src/composables/useDesktopLyricsDisplay.test.ts src/composables/useDesktopLyricsDisplay.ts src/components/player/DesktopLyricsWindow.vue
git commit -m "feat: align romaji under japanese words"
```

Expected: commit succeeds. If pre-existing user edits are mixed into these files, review the diff carefully and include only the final intended combined state; do not revert user work.

---

## Self-Review

Spec coverage:

- Complete per-word alignment: Task 1 and Task 2.
- Whole-line fallback on incomplete matching: Task 1, Task 2, Task 3.
- Main player AMLL behavior: Task 2.
- Desktop lyrics behavior: Task 3 and Task 4.
- Translation preservation: Task 3 tests.
- Test coverage and verification: Task 5.

Placeholder scan: no unresolved placeholder wording remains.

Type consistency: `hasAlignedRomaji` is introduced in `DesktopLyricDisplayLine`, populated in `visibleLyricLines`, consumed by `DesktopLyricsWindow.vue`, and covered by `useDesktopLyricsDisplay.test.ts`.
