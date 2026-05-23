<script setup lang="ts">
import { computed } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import { useCustomThemeModal } from '../../composables/useCustomThemeModal';

const emit = defineEmits(['close']);
const {
  preview,
  handleSelectImage,
  handleCancel: discardThemeDraft,
  handleSave: applyThemeDraft,
} = useCustomThemeModal();

const foregroundOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const isDarkForeground = computed(() => preview.value.foregroundStyle === 'dark');

const handleCancel = () => {
  discardThemeDraft();
  emit('close');
};

const handleSave = () => {
  applyThemeDraft();
  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div class="flex max-h-[calc(100vh-2rem)] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md">
        <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <span class="text-base font-bold">自定义皮肤</span>
          <button @click="handleCancel" class="text-white/50 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div class="flex flex-col gap-6 p-6">
            <div class="group relative h-48 w-full overflow-hidden rounded-xl border border-white/5 bg-[#1a1a1a]">
              <div v-if="preview.imagePath" class="absolute inset-0">
                <img
                  :src="convertFileSrc(preview.imagePath)"
                  class="h-full w-full object-cover"
                  :style="{ filter: `blur(${preview.blur}px) brightness(${preview.opacity ?? 1.0})`, transform: `scale(${preview.scale})` }"
                />
                <div
                  class="absolute inset-0 z-10"
                  :style="{ backgroundColor: preview.maskColor, opacity: preview.maskAlpha }"
                ></div>
              </div>

              <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                <svg xmlns="http://www.w3.org/2000/svg" class="mb-2 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span class="text-xs">未选择图片</span>
              </div>

              <div class="absolute inset-x-0 bottom-0 z-[15] px-4 pb-4">
                <div class="flex items-end justify-between gap-3">
                  <div class="min-w-0">
                    <div
                      class="text-[10px] font-medium uppercase tracking-[0.2em]"
                      :class="isDarkForeground ? 'text-black/45' : 'text-white/60'"
                    >
                      字体预览
                    </div>
                    <div
                      class="mt-1 truncate text-base font-bold"
                      :class="isDarkForeground ? 'text-[#111111] drop-shadow-[0_1px_6px_rgba(255,255,255,0.18)]' : 'text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]'"
                    >
                      夜航星
                    </div>
                    <div
                      class="mt-1 truncate text-[12px]"
                      :class="isDarkForeground ? 'text-black/65' : 'text-white/72'"
                    >
                      浅色和深色字体会直接预览在这里
                    </div>
                  </div>

                  <div
                    class="shrink-0 text-[11px] font-semibold"
                    :class="isDarkForeground ? 'text-black/70' : 'text-white/85'"
                  >
                    {{ preview.foregroundStyle === 'light' ? '浅色字体' : '深色字体' }}
                  </div>
                </div>
              </div>

              <div
                @click="handleSelectImage"
                class="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <div class="mb-2 rounded-full bg-white/20 p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <span class="text-sm font-medium">选择本地图片</span>
              </div>
            </div>

            <div class="space-y-5">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>模糊度</span>
                  <span>{{ preview.blur }}px</span>
                </div>
                <input
                  v-model.number="preview.blur"
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>遮罩浓度</span>
                  <span>{{ Math.round(preview.maskAlpha * 100) }}%</span>
                </div>
                <input
                  v-model.number="preview.maskAlpha"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>背景亮度</span>
                  <span>{{ Math.round(preview.opacity * 100) }}%</span>
                </div>
                <input
                  v-model.number="preview.opacity"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>画面缩放</span>
                  <span>{{ preview.scale.toFixed(2) }}x</span>
                </div>
                <input
                  v-model.number="preview.scale"
                  type="range"
                  min="1"
                  max="1.5"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>字体颜色</span>
                </div>
                <div class="flex gap-1 rounded-lg bg-white/10 p-1">
                  <button
                    v-for="option in foregroundOptions"
                    :key="option.value"
                    @click="preview.foregroundStyle = option.value"
                    class="flex-1 rounded-md py-1.5 text-xs font-medium transition-all"
                    :class="preview.foregroundStyle === option.value ? 'bg-[#EC4141] text-white shadow-sm' : 'text-white/60 hover:bg-white/5 hover:text-white'"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex gap-4 border-t border-white/10 bg-[#242424] px-6 py-4">
          <button @click="handleCancel" class="flex-1 rounded-full border border-white/10 py-2.5 text-sm font-medium transition hover:bg-white/5">
            取消
          </button>
          <button
            @click="handleSave"
            :disabled="!preview.imagePath"
            class="flex-1 rounded-full bg-[#EC4141] py-2.5 text-sm font-bold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#EC4141]"
          >
            保存并使用
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
input[type='range'] {
  height: 6px;
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}
</style>
