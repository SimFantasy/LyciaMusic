<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { usePlayer } from '../../composables/player';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { isRemoteSong } from '../../utils/remoteSong';
import ModernModal from '../common/ModernModal.vue';

const {
  playQueue,
  currentSong,
  showPlaylist,
  togglePlaylist,
  playSong,
  formatDuration,
  clearQueue,
  removeSongFromQueue,
} = usePlayer();
const { theme } = useThemeSettings();

const showClearModal = ref(false);
const itemRefs = ref<HTMLElement[]>([]);

const handleClearClick = () => {
  showClearModal.value = true;
};

const confirmClear = () => {
  clearQueue();
  showClearModal.value = false;
};

const handleRemove = (song: any, e: Event) => {
  e.stopPropagation();
  removeSongFromQueue(song);
};

const setItemRef = (el: Element | ComponentPublicInstance | null, index: number) => {
  if (el instanceof HTMLElement) {
    itemRefs.value[index] = el;
  }
};

const scrollToCurrentSong = async (behavior: ScrollBehavior = 'auto') => {
  if (!currentSong.value) return;

  await nextTick();

  const currentIndex = playQueue.value.findIndex(song => song.path === currentSong.value?.path);
  if (currentIndex === -1) return;

  itemRefs.value[currentIndex]?.scrollIntoView({
    behavior,
    block: 'center',
  });
};

watch(
  () => showPlaylist.value,
  visible => {
    if (!visible) return;
    void scrollToCurrentSong();
  },
);

watch(
  () => currentSong.value?.path,
  () => {
    if (!showPlaylist.value) return;
    void scrollToCurrentSong('smooth');
  },
);
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="showPlaylist" class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]" @click="togglePlaylist"></div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showPlaylist"
        class="fixed right-0 rounded-l-2xl shadow-[0_8px_30px_rgba(0,0,0,0.1)] border-l border-t border-b border-white/30 dark:border-white/10 z-[100] flex flex-col overflow-hidden font-sans select-none bg-white/40 dark:bg-gray-900/40 transition-all duration-300"
        :class="[
          (theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-2xl',
          playQueue.length > 0 ? 'bottom-24 w-[340px]' : 'bottom-5 w-[340px]'
        ]"
        :style="{ height: playQueue.length > 0 ? 'calc(100vh - 180px)' : 'calc(100vh - 40px)', 'min-height': '200px' }"
        @click.stop
      >
        <div
          class="px-5 py-4 border-b border-black/5 dark:border-white/5 flex justify-between items-center bg-white/30 dark:bg-black/20 z-10"
          :class="[(theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-sm']"
        >
          <div class="flex items-center gap-3">
            <h3 class="font-bold text-gray-800 dark:text-gray-100 text-lg tracking-tight">播放队列</h3>
            <span class="text-xs text-gray-500 dark:text-white/40 font-medium bg-gray-200/60 dark:bg-white/10 px-2 py-0.5 rounded-full">{{ playQueue.length }}</span>
          </div>
          <button
            @click="handleClearClick"
            class="text-gray-600 dark:text-white/60 hover:text-[#EC4141] text-sm hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 active:scale-95"
            title="清空队列"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>清空</span>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          <div v-if="playQueue.length === 0" class="h-full flex flex-col items-center justify-center text-gray-500 dark:text-white/40 space-y-4 py-20">
            <div class="w-20 h-20 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <span class="text-sm">播放队列为空</span>
          </div>

          <div
            v-for="(song, index) in playQueue"
            :key="song.path + index"
            :ref="el => setItemRef(el, index)"
            @click="playSong(song)"
            class="group relative p-2.5 rounded-xl flex justify-between items-center cursor-pointer transition-all duration-200 border border-transparent"
            :class="[
              currentSong?.path === song.path
                ? 'bg-[#EC4141]/5 dark:bg-[#EC4141]/10 text-[#EC4141] border-[#EC4141]/10 shadow-sm'
                : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-900 dark:text-gray-100 hover:border-black/5 dark:hover:border-white/5'
            ]"
          >
            <div class="w-8 flex justify-center items-center shrink-0">
              <div v-if="currentSong?.path === song.path" class="flex items-end gap-[2px] h-3">
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-1"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-2"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-3"></div>
              </div>
              <template v-else>
                <span class="text-xs text-gray-500 dark:text-white/50 group-hover:hidden font-mono">{{ index + 1 }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="hidden group-hover:block h-3 w-3 text-gray-600 dark:text-white/60" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
              </template>
            </div>

            <div class="flex-1 min-w-0 pr-4 flex flex-col">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate text-sm font-medium leading-tight">{{ song.title || song.name.replace(/\.[^/.]+$/, "") }}</span>
                <span
                  v-if="isRemoteSong(song)"
                  class="shrink-0 rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
                >远程</span>
              </div>
              <span
                class="text-[11px] truncate mt-1"
                :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-600 dark:text-white/50'"
              >{{ song.artist || 'Unknown Artist' }}</span>
            </div>

            <div class="flex items-center gap-3">
              <div class="text-xs font-mono shrink-0 group-hover:hidden" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-600 dark:text-white/50'">
                {{ formatDuration(song.duration) }}
              </div>
              <button
                @click="handleRemove(song, $event)"
                class="hidden group-hover:flex w-6 h-6 items-center justify-center text-gray-500 dark:text-white/60 hover:text-red-500 transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90"
                title="移出队列"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <ModernModal
      v-model:visible="showClearModal"
      title="清空播放队列"
      content="确定要清空当前播放队列吗？此操作不会影响本地文件。"
      type="danger"
      confirm-text="清空"
      @confirm="confirmClear"
    />
  </Teleport>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes music-bar {
  0%, 100% { height: 4px; }
  50% { height: 12px; }
}

.animate-music-bar-1 { animation: music-bar 0.6s ease-in-out infinite; }
.animate-music-bar-2 { animation: music-bar 0.8s ease-in-out infinite 0.1s; }
.animate-music-bar-3 { animation: music-bar 0.7s ease-in-out infinite 0.2s; }
</style>
