<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  type TaskbarPlayerStatePayload,
} from '../../features/taskbarPlayer/shared';
import { writeSavedPositionX } from '../../composables/useTaskbarPlayerBridge';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();

const currentSong = ref<Song | null>(null);
const localCoverUrl = ref('');
const isPlaying = ref(false);
const isDarkTheme = ref(true); // 任务栏播控默认采用高质感暗色毛玻璃设计，适配大多数用户底色
const isVisible = ref(false);

const titleElement = ref<HTMLElement | null>(null);
const titleWrapperElement = ref<HTMLElement | null>(null);
const shouldScroll = ref(false);

let unlistenState: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenMoved: (() => void) | null = null;

const sendAction = (actionType: 'prev-song' | 'next-song' | 'toggle-play' | 'close') => {
  void appWindow.emit('main', {
    type: TASKBAR_PLAYER_ACTION_EVENT,
    payload: { type: actionType },
  });
};

const checkTitleScroll = () => {
  void nextTick(() => {
    if (titleElement.value && titleWrapperElement.value) {
      const scrollWidth = titleElement.value.scrollWidth;
      const clientWidth = titleWrapperElement.value.clientWidth;
      shouldScroll.value = scrollWidth > clientWidth;
    } else {
      shouldScroll.value = false;
    }
  });
};

watch(currentSong, () => {
  checkTitleScroll();
});

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to set transparent window background:', error);
  }

  // 1. 监听状态更新
  unlistenState = await listen<TaskbarPlayerStatePayload>(TASKBAR_PLAYER_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    localCoverUrl.value = event.payload.coverUrl;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    void nextTick(() => {
      void appWindow.emit('main', { type: TASKBAR_PLAYER_STATE_APPLIED_EVENT });
      checkTitleScroll();
    });
  });

  // 2. 监听可见性
  unlistenVisibility = await listen<{ visible: boolean }>(TASKBAR_PLAYER_VISIBILITY_EVENT, (event) => {
    isVisible.value = event.payload.visible;
  });

  // 3. 监听位置移动（拖动拉手松开后自动持久化写入 localStorage 恢复自愈）
  unlistenMoved = await appWindow.onMoved(async () => {
    const factor = await appWindow.scaleFactor();
    const position = (await appWindow.outerPosition()).toLogical(factor);
    writeSavedPositionX(position.x);
  });

  // 4. 发送 Ready 握手并请求一次最新状态
  void appWindow.emit('main', { type: 'taskbar-player:ready' });
  void appWindow.emit('main', { type: 'taskbar-player:request-state' });
});

onUnmounted(() => {
  unlistenState?.();
  unlistenVisibility?.();
  unlistenMoved?.();
});
</script>

<template>
  <div
    class="w-[360px] h-[40px] relative flex items-center justify-between select-none overflow-hidden rounded-xl border border-white/5 shadow-2xl pl-2 pr-3.5 transition-all duration-300 bg-[#121214]/65 backdrop-blur-md"
  >
    <!-- 极简白色竖条拉手（采用外层 22px 宽的隐形热区, 并在悬停时 group 联动触发内层竖条呼吸高亮） -->
    <div 
      class="group w-[22px] h-[34px] -ml-1.5 mr-1 shrink-0 flex items-center justify-center cursor-move"
      data-tauri-drag-region="true"
      title="按住拖拽调整播控条位置"
    >
      <div 
        class="w-[4px] h-[16px] rounded-full bg-white/40 group-hover:bg-white/80 group-active:bg-white transition-all duration-300 pointer-events-none group-hover:scale-x-125 group-hover:shadow-[0_0_8px_rgba(255,255,255,0.6)]"
      ></div>
    </div>

    <!-- 左侧：封面与歌曲信息 -->
    <div class="flex items-center gap-2.5 min-w-0 flex-1 mr-4 pointer-events-none">
      <!-- 封面 -->
      <div class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/5 flex items-center justify-center text-white/40">
        <img v-if="localCoverUrl" :src="localCoverUrl" class="w-full h-full object-cover" />
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </div>

      <!-- 文字信息（歌名/歌手） -->
      <div class="flex flex-col min-w-0 leading-tight">
        <!-- 歌曲标题（带跑马灯逻辑） -->
        <div 
          ref="titleWrapperElement" 
          class="text-xs text-white/95 font-semibold truncate w-[140px] overflow-hidden relative"
        >
          <div
            ref="titleElement"
            class="inline-block whitespace-nowrap"
            :class="{ 'marquee-scroll': shouldScroll }"
          >
            {{ currentSong ? (currentSong.title || currentSong.name) : 'Lycia Player' }}
          </div>
        </div>

        <!-- 歌手名 -->
        <div class="text-[10px] text-white/50 truncate w-[140px]">
          {{ currentSong ? currentSong.artist : '享受音乐时光' }}
        </div>
      </div>
    </div>

    <!-- 右侧：上一首、播放/暂停、下一首控制 -->
    <div class="flex items-center gap-3.5 shrink-0 z-20">
      <!-- 上一首 -->
      <button 
        @click.stop="sendAction('prev-song')" 
        class="text-white/60 hover:text-white transition-colors duration-200 active:scale-90"
        title="上一首"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      <!-- 播放/暂停（经典汽水胶囊药丸宽圆角背景） -->
      <button 
        @click.stop="sendAction('toggle-play')" 
        class="w-11 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all duration-200 active:scale-95 border border-white/5"
        title="播放/暂停"
      >
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>

      <!-- 下一首 -->
      <button 
        @click.stop="sendAction('next-song')" 
        class="text-white/60 hover:text-white transition-colors duration-200 active:scale-90"
        title="下一首"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.marquee-scroll {
  display: inline-block;
  animation: marquee-anim 8s linear infinite;
  padding-left: 20px;
}

@keyframes marquee-anim {
  0% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-35%, 0, 0);
  }
  100% {
    transform: translate3d(0, 0, 0);
  }
}
</style>

<style>
/* 强制窗口背景绝对透明，彻底去除圆角外多余的拐角黑色边缘 */
html, body, #app {
  background: transparent !important;
  background-color: transparent !important;
  overflow: hidden !important;
}
</style>
