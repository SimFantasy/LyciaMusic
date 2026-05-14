# Romaji Word Alignment Design

Date: 2026-05-14

## Goal

Japanese lyrics with timed romaji should render romaji under the matching Japanese word instead of showing romaji only as a whole secondary line.

For the sample line:

- Main words: `か`, `弱`, `い`, `光`, `が`, `指`, `差`, `す`, `先`
- Romaji fragments: `ka`, `yo`, `wa`, `i`, `hi`, `ka`, `ri`, `ga`, `yu`, `bi`, `sa`, `su`, `sa`, `ki`

The expected aligned output is:

- `か` -> `ka`
- `弱` -> `yo wa`
- `い` -> `i`
- `光` -> `hi ka ri`
- `が` -> `ga`
- `指` -> `yu bi`
- `差` -> `sa`
- `す` -> `su`
- `先` -> `sa ki`

The main player and desktop lyrics window must both use this behavior when alignment is complete.

## Current Behavior

The lyric pipeline can carry line-level romaji through `LyricLine.romaji`. The main player converts lyrics to AMLL lines in `src/composables/lyrics/converters.ts`; desktop lyrics renders in `src/components/player/DesktopLyricsWindow.vue` using display state from `src/composables/useDesktopLyricsDisplay.ts`.

When per-word romaji is unavailable or not trusted, romaji is rendered as a whole secondary line. This produces the current visual bug: the romaji text appears as `ka yo wa i hi ka ri ...` below the entire Japanese line instead of being grouped under each Japanese word.

Some parser/classifier logic already attempts to merge romaji words into `word.romaji`. The implementation must make that contract reliable and enforce a complete-match fallback rule.

## Requirements

1. Align romaji under Japanese words only when every visible main word has a non-empty aligned romaji value.
2. Merge multiple timed romaji fragments into one Japanese word when their timing belongs to that word.
3. If alignment is incomplete, ambiguous, or missing for any main word, fall back to the current whole-line romaji secondary display.
4. Apply the same complete-match rule in both the main player and desktop lyrics.
5. Preserve translation display. When word-aligned romaji is active, translation remains a secondary line; when alignment falls back, romaji remains a secondary line before translation according to current ordering.
6. Preserve existing word timing, highlighting, seeking behavior, and lyric data shape unless a narrow additive field is needed.

## Proposed Design

Use the existing `LyricWord.romaji` contract as the shared source of truth.

The semantic conversion layer should map romanization words to main words by timing. For each main word, collect romaji fragments whose time range overlaps that main word or falls within the configured alignment tolerance. Concatenate collected fragments with their source spacing normalized to single spaces. A line is considered word-alignable only if every main word receives a non-empty romanized text.

If all words are aligned:

- `semanticLineToLyricLine` writes each aligned value to `line.words[index].romaji`.
- `line.romaji` remains available as the full text for fallback and non-word displays.
- `romajiWords` may remain available for independent timed romaji cases, but it must not override complete per-word alignment.

If any word is not aligned:

- Do not partially render word-level romaji.
- Keep `line.words[index].romaji` empty or omit it for display purposes.
- Keep `line.romaji` so existing whole-line secondary rendering continues to work.

## Main Player Rendering

`convertLyricsToAmlLines` should compute `canRenderAlignedRomaji` as true only when:

- `showRomaji` is true.
- The line has timed main words.
- Every rendered main word has a non-empty trimmed `romaji`.

When true, pass each word's romaji to AMLL as `romanWord` and leave `romanLyric` empty. AMLL then renders each Japanese word as a stack with centered romaji below it.

When false, leave `romanWord` empty and pass line-level romaji through `romanLyric`, preserving current whole-line fallback behavior.

## Desktop Lyrics Rendering

Desktop lyrics needs a separate render path because it does not use AMLL. `useDesktopLyricsDisplay` should expose whether a display line has complete word-level romaji, derived with the same rule as the main player.

When complete word-level romaji is available:

- Render each `.desktop-lyric-word` as a vertical word stack.
- The main text remains the highlighted top text.
- The romaji text is centered below the corresponding word.
- Do not include romaji in `secondaryLines`.
- Keep translation in `secondaryLines` if enabled.

When complete word-level romaji is unavailable:

- Render main words exactly as today.
- Include line-level romaji in `secondaryLines` when `showRomaji` is enabled.
- Keep translation behavior unchanged.

The desktop word highlight style should apply to the main text span only, not to the romaji text, so the romaji remains readable and stable while the main word color animation continues.

## Error Handling And Fallbacks

Incomplete matching must be conservative. Any of these cases should use whole-line fallback:

- A main word has no romaji fragments.
- The line has main words but no usable timed romaji source.
- Timing is invalid or non-finite for a required word.
- The matching result would assign an empty value after trimming.

This avoids misleading partial alignment.

## Testing

Add or update unit tests for:

1. The provided sample line maps `か/弱/い/光/...` to `ka/yo wa/i/hi ka ri/...`.
2. `convertLyricsToAmlLines` emits per-word `romanWord` and no `romanLyric` when every word has romaji.
3. `convertLyricsToAmlLines` falls back to whole-line `romanLyric` when any word is missing romaji.
4. `useDesktopLyricsDisplay` marks a line as word-romaji alignable only when all displayed words have romaji.
5. Desktop secondary lines omit romaji during word-aligned rendering and keep translation.
6. Desktop secondary lines include whole-line romaji when word alignment is incomplete.

Manual visual verification should cover both the main player and desktop lyrics window with the sample lyric, with translation enabled and disabled.

## Out Of Scope

- Changing lyric file formats or adding a new persisted setting.
- Implementing partial word-level romaji display.
- Changing translation classification.
- Changing desktop lyric window layout options outside the romaji display path.
