<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { playbackApi } from '../../services/tauri/playbackApi';

const props = defineProps<{
  active: boolean;
  isPlaying: boolean;
  songPath: string;
}>();

const BAR_COUNT = 48;
const DISPLAY_BAR_COUNT = 112;
const FETCH_INTERVAL_MS = 50;
const MIN_BAR_HEIGHT = 3;
const PEAK_DECAY = 0.86;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const levels = ref<number[]>(Array(BAR_COUNT).fill(0));
const peakLevels = ref<number[]>(Array(DISPLAY_BAR_COUNT).fill(0));
const renderedLevels = ref<number[]>(Array(DISPLAY_BAR_COUNT).fill(0));

let animationFrameId: number | null = null;
let fetchTimerId: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;
let sampleTick = 0;

const stopFetchTimer = () => {
  if (fetchTimerId !== null) {
    clearInterval(fetchTimerId);
    fetchTimerId = null;
  }
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const getDisplayLevel = (index: number) => {
  const sourcePosition = (index / Math.max(1, DISPLAY_BAR_COUNT - 1)) * (BAR_COUNT - 1);
  const leftIndex = Math.floor(sourcePosition);
  const rightIndex = Math.min(BAR_COUNT - 1, leftIndex + 1);
  const mix = sourcePosition - leftIndex;
  const left = levels.value[leftIndex] ?? 0;
  const right = levels.value[rightIndex] ?? left;

  return left + (right - left) * mix;
};

const stableNoise = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const shouldAnimate = () =>
  props.active && (
    props.isPlaying
    || peakLevels.value.some(level => level > 0.012)
    || renderedLevels.value.some(level => level > 0.012)
  );

const draw = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  resizeCanvas();
  const context = canvas.getContext('2d');
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const pixelRatio = window.devicePixelRatio || 1;
  const baselineY = height - 2 * pixelRatio;
  const barWidth = Math.max(1.2 * pixelRatio, Math.min(2.4 * pixelRatio, width / (DISPLAY_BAR_COUNT * 3.5)));
  const gap = Math.max(3.5 * pixelRatio, (width - barWidth * DISPLAY_BAR_COUNT) / (DISPLAY_BAR_COUNT - 1));
  const visualizerWidth = barWidth * DISPLAY_BAR_COUNT + gap * (DISPLAY_BAR_COUNT - 1);
  const startX = (width - visualizerWidth) / 2;

  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowBlur = 7 * pixelRatio;
  context.shadowColor = 'rgba(151, 191, 211, 0.36)';

  const inactiveScale = props.isPlaying ? 1 : 0.45;

  for (let index = 0; index < DISPLAY_BAR_COUNT; index += 1) {
    const rawValue = Math.max(0, getDisplayLevel(index));
    const bandPosition = index / Math.max(1, DISPLAY_BAR_COUNT - 1);
    const baseValue = Math.pow(rawValue, 0.46) * inactiveScale;
    const lowFrequencyWeight = 1.38 - bandPosition * 0.78;
    const spikeChance = bandPosition < 0.32 ? 0.24 : bandPosition < 0.62 ? 0.12 : 0.055;
    const noise = stableNoise(index * 9.7 + sampleTick * 1.37);
    const pulse = 0.72 + Math.sin(sampleTick * 0.52 + index * 0.83) * 0.28;
    const spikeScale = noise > 1 - spikeChance
      ? 1.75 + pulse * 0.75
      : 0.18 + noise * 0.46;
    const targetValue = Math.min(1, baseValue * lowFrequencyWeight * spikeScale);
    const previousPeak = peakLevels.value[index] ?? 0;
    const peakValue = targetValue > previousPeak
      ? targetValue
      : Math.max(targetValue, previousPeak * PEAK_DECAY);
    const previousRendered = renderedLevels.value[index] ?? 0;
    const value = peakValue > previousRendered
      ? previousRendered + (peakValue - previousRendered) * 0.78
      : previousRendered * 0.82 + peakValue * 0.18;

    peakLevels.value[index] = peakValue;
    renderedLevels.value[index] = value;

    const edgeDistance = Math.abs(index - (DISPLAY_BAR_COUNT - 1) / 2) / (DISPLAY_BAR_COUNT / 2);
    const edgeFade = 1 - Math.pow(edgeDistance, 2) * 0.16;
    const barHeight = Math.max(
      MIN_BAR_HEIGHT * pixelRatio,
      value * height * 0.88 * edgeFade,
    );
    const x = startX + index * (barWidth + gap);
    const y = baselineY - barHeight;
    const radius = Math.min(barWidth / 2, 2 * pixelRatio);
    const alpha = props.isPlaying ? 0.36 + value * 0.42 : 0.2;
    const barGradient = context.createLinearGradient(0, y, 0, baselineY);

    barGradient.addColorStop(0, `rgba(184, 219, 236, ${alpha * 0.86})`);
    barGradient.addColorStop(0.45, `rgba(137, 183, 207, ${alpha})`);
    barGradient.addColorStop(1, `rgba(95, 145, 174, ${alpha * 0.72})`);

    context.fillStyle = barGradient;
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, radius);
    context.fill();
  }

  context.restore();

  if (shouldAnimate()) {
    scheduleDraw();
  }
};

const scheduleDraw = () => {
  if (animationFrameId !== null) return;

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    draw();
  });
};

const fetchSamples = async () => {
  if (!props.active || !props.isPlaying) return;

  try {
    const nextLevels = await playbackApi.getAudioVisualizerSamples();
    if (nextLevels.length > 0) {
      levels.value = nextLevels.slice(0, BAR_COUNT);
      sampleTick += 1;
      scheduleDraw();
    }
  } catch {}
};

const syncFetchTimer = () => {
  stopFetchTimer();
  if (!props.active || !props.isPlaying) {
    scheduleDraw();
    return;
  }

  void fetchSamples();
  fetchTimerId = setInterval(() => {
    void fetchSamples();
  }, FETCH_INTERVAL_MS);
};

watch(() => [props.active, props.isPlaying] as const, syncFetchTimer);

watch(() => props.songPath, () => {
  levels.value = Array(BAR_COUNT).fill(0);
  peakLevels.value = Array(DISPLAY_BAR_COUNT).fill(0);
  renderedLevels.value = Array(DISPLAY_BAR_COUNT).fill(0);
  sampleTick = 0;
  scheduleDraw();
  syncFetchTimer();
});

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) {
    resizeObserver = new ResizeObserver(() => scheduleDraw());
    resizeObserver.observe(canvas);
  }

  void nextTick(() => {
    scheduleDraw();
    syncFetchTimer();
  });
});

onBeforeUnmount(() => {
  stopFetchTimer();
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
  resizeObserver?.disconnect();
});
</script>

<template>
  <canvas
    ref="canvasRef"
    class="audio-visualizer"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
.audio-visualizer {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
