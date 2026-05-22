<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { LyricLine } from '../../composables/lyrics';
import {
  LIGHT_LYRIC_PROGRESS_FRAME_MS,
  findLightLyricIndexByTime,
  getLightLyricRenderableWords,
  getLightLyricVisibleWindow,
  resolveLightLyricActiveWord,
} from './lightLyricPlayerModel';

const props = withDefaults(defineProps<{
  lyricLines?: LyricLine[];
  currentTime?: number;
  playing?: boolean;
  showTranslation?: boolean;
  showRomaji?: boolean;
  lineGap?: number;
}>(), {
  lyricLines: () => [],
  currentTime: 0,
  playing: true,
  showTranslation: true,
  showRomaji: false,
  lineGap: 1,
});

const emit = defineEmits<{
  (e: 'line-click', line: LyricLine): void;
}>();

const progressTime = ref(props.currentTime);
let progressFrameId = 0;
let lastFrameTime = 0;
let anchorPlaybackTime = props.currentTime;
let anchorFrameTime = 0;

const activeLineIndex = computed(() => findLightLyricIndexByTime(props.lyricLines, progressTime.value));
const visibleLines = computed(() => getLightLyricVisibleWindow(props.lyricLines, activeLineIndex.value));
const activeLine = computed(() => props.lyricLines[activeLineIndex.value]);
const activeWord = computed(() => resolveLightLyricActiveWord(activeLine.value, progressTime.value));
const hasActiveTimedWords = computed(() => Boolean(activeLine.value?.words?.some((word) => word.end > word.start)));
const lineGapStyle = computed(() => ({ '--light-line-gap': props.lineGap.toString() }));

function resetProgressAnchor() {
  progressTime.value = props.currentTime;
  anchorPlaybackTime = props.currentTime;
  anchorFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
}

function stopProgressLoop() {
  if (progressFrameId !== 0) {
    cancelAnimationFrame(progressFrameId);
    progressFrameId = 0;
  }
  lastFrameTime = 0;
}

function shouldRunProgressLoop() {
  return props.playing && hasActiveTimedWords.value && typeof requestAnimationFrame === 'function';
}

function startProgressLoop() {
  stopProgressLoop();
  if (!shouldRunProgressLoop()) return;

  anchorPlaybackTime = props.currentTime;
  anchorFrameTime = performance.now();
  lastFrameTime = 0;

  const tick = (frameTime: number) => {
    if (!shouldRunProgressLoop()) {
      stopProgressLoop();
      return;
    }

    if (lastFrameTime === 0 || frameTime - lastFrameTime >= LIGHT_LYRIC_PROGRESS_FRAME_MS) {
      progressTime.value = anchorPlaybackTime + Math.max(0, frameTime - anchorFrameTime) / 1000;
      lastFrameTime = frameTime;
    }

    progressFrameId = requestAnimationFrame(tick);
  };

  progressFrameId = requestAnimationFrame(tick);
}

function getWordStyle(visibleIndex: number, wordIndex: number) {
  if (visibleIndex !== activeLineIndex.value || activeWord.value?.index !== wordIndex) {
    return { '--word-progress': '0%' };
  }

  return { '--word-progress': `${Math.round(activeWord.value.progress * 10000) / 100}%` };
}

function getLineText(line: LyricLine) {
  return line.text || line.words?.map((word) => word.text).join('') || '';
}

watch(() => props.currentTime, () => {
  resetProgressAnchor();
  startProgressLoop();
});

watch(() => props.playing, () => {
  resetProgressAnchor();
  startProgressLoop();
}, { immediate: true });

watch(() => props.lyricLines, () => {
  resetProgressAnchor();
  startProgressLoop();
}, { deep: false });

onBeforeUnmount(() => {
  stopProgressLoop();
});
</script>

<template>
  <div class="light-lyrics-player" :style="lineGapStyle">
    <div class="light-lyrics-stack">
      <button
        v-for="item in visibleLines"
        :key="`${item.index}:${item.line.time}:${item.line.text}`"
        type="button"
        class="light-lyric-line"
        :class="{ 'light-lyric-line--active': item.isActive }"
        @click="emit('line-click', item.line)"
      >
        <span class="light-lyric-main">
          <template v-if="item.line.words && item.line.words.length > 0">
            <span
              v-for="{ word, index: wordIndex } in getLightLyricRenderableWords(item.line)"
              :key="`${wordIndex}:${word.start}:${word.text}`"
              class="light-lyric-word"
              :class="{ 'light-lyric-word--active': item.isActive && activeWord?.index === wordIndex }"
              :style="getWordStyle(item.index, wordIndex)"
            >
              <span class="light-lyric-word-base">{{ word.text }}</span>
              <span class="light-lyric-word-fill">{{ word.text }}</span>
            </span>
          </template>
          <template v-else>
            {{ getLineText(item.line) }}
          </template>
        </span>
        <span v-if="showRomaji && item.line.romaji" class="light-lyric-subline light-lyric-romaji">
          {{ item.line.romaji }}
        </span>
        <span v-if="showTranslation && item.line.translation" class="light-lyric-subline light-lyric-translation">
          {{ item.line.translation }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.light-lyrics-player {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  align-items: center;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.95);
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
}

.light-lyrics-stack {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: calc(18px * var(--light-line-gap, 1));
  transition: transform 220ms ease;
}

.light-lyric-line {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: var(--light-align-items, flex-start);
  border: 0;
  padding: calc(5px * var(--light-line-gap, 1)) 0;
  text-align: var(--lyrics-text-align, left);
  color: rgba(255, 255, 255, 0.42);
  background: transparent;
  opacity: 0.62;
  transition: opacity 180ms ease, color 180ms ease, transform 220ms ease;
}

.light-lyric-line:hover {
  color: rgba(255, 255, 255, 0.72);
}

.light-lyric-line--active {
  color: rgba(255, 255, 255, 0.96);
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

.light-lyric-main {
  max-width: min(100%, 920px);
  font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  font-weight: 750;
  line-height: 1.16;
  overflow-wrap: anywhere;
}

.light-lyric-subline {
  max-width: min(100%, 900px);
  margin-top: 0.42em;
  font-size: calc(max(max(2.4vh, 1.2vw), 11px) * var(--lyrics-font-scale, 1));
  font-weight: 600;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.52);
  overflow-wrap: anywhere;
}

.light-lyric-line--active .light-lyric-subline {
  color: rgba(255, 255, 255, 0.68);
}

.light-lyric-word {
  position: relative;
  display: inline-block;
  white-space: pre-wrap;
}

.light-lyric-word-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--word-progress, 0%);
  overflow: hidden;
  color: rgba(255, 255, 255, 1);
  white-space: pre-wrap;
  pointer-events: none;
}

.light-lyric-word-base {
  color: currentColor;
}

.light-lyric-line--active .light-lyric-word-base {
  color: rgba(255, 255, 255, 0.56);
}

.light-lyric-line--active .light-lyric-word--active .light-lyric-word-base {
  color: rgba(255, 255, 255, 0.34);
}

@media screen and (max-width: 768px) {
  .light-lyric-main {
    font-size: calc(max(8vw, 12px) * var(--lyrics-font-scale, 1));
  }

  .light-lyric-subline {
    font-size: calc(max(3.6vw, 11px) * var(--lyrics-font-scale, 1));
  }
}
</style>
