<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Song, SongDetail } from '../../types';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayer } from '../../composables/player';
import { useSongDetailCache } from '../../composables/useSongDetailCache';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits(['close']);

const { loadCover } = useCoverCache();
const { loadSongDetail } = useSongDetailCache();
const { openInFinder } = usePlayer();

const coverUrl = ref('');
const isClosing = ref(false);
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
    isClosing.value = false;
  }, 200); // 时长匹配退出动画
};

watch(
  [() => props.visible, () => props.song?.path ?? ''],
  async ([visible, path]) => {
    const requestId = ++detailRequestId;

    if (!visible || !path) {
      currentSongDetail.value = null;
      setTimeout(() => {
        if (requestId === detailRequestId) {
          coverUrl.value = '';
        }
      }, 200);
      return;
    }

    isClosing.value = false;

    const [url, detail] = await Promise.all([
      loadCover(path),
      loadSongDetail(path).catch(() => null),
    ]);

    if (requestId !== detailRequestId || !props.visible || path !== (props.song?.path ?? '')) {
      return;
    }

    coverUrl.value = url || '';
    currentSongDetail.value = detail;
  },
  { immediate: true },
);

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

const handleOpenFolder = () => {
  if (props.song?.path) {
    void openInFinder(props.song.path);
    handleClose();
  }
};

const displaySong = computed(() => {
  if (!props.song) {
    return null;
  }

  return {
    ...props.song,
    genre: currentSongDetail.value?.genre ?? props.song.genre,
    year: currentSongDetail.value?.year ?? props.song.year,
    container: currentSongDetail.value?.container ?? props.song.container,
    codec: currentSongDetail.value?.codec ?? props.song.codec,
    file_size: currentSongDetail.value?.file_size ?? props.song.file_size,
    track_number: currentSongDetail.value?.track_number,
    disc_number: currentSongDetail.value?.disc_number,
  };
});

// 格式化工具
const formatSize = (bytes?: number) => {
  if (bytes === undefined || bytes <= 0) return '无';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDuration = (seconds?: number) => {
  if (!seconds) return '无';
  const totalSeconds = Math.floor(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatBitrate = (bitrate?: number) => {
  if (!bitrate) return '待扫描';
  return `${Math.round(bitrate)} kbps`;
};

const formatSampleRate = (rate?: number) => {
  if (!rate) return '无';
  return `${(rate / 1000).toFixed(1)} kHz`;
};

const formatTime = (timestampSeconds?: number) => {
  if (!timestampSeconds) return '无';
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleString();
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6"
      :class="{'pointer-events-none': isClosing}"
    >
      <!-- 背景盖板 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- 模态框主体 -->
      <div
        class="relative w-full max-w-2xl bg-white/85 dark:bg-gray-900/90 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col transform transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1) border border-white/40 dark:border-white/10"
        :class="isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0'"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200/50 dark:border-gray-700/50 shrink-0">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">歌曲信息</h2>
          <button
            @click="handleClose"
            class="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div v-if="displaySong" class="p-6 overflow-y-auto custom-scrollbar">
          <!-- 上半部分：封面 + 基本信息 -->
          <div class="flex flex-col sm:flex-row gap-6 mb-4">
            <div class="w-32 h-32 shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-md border border-gray-200/50 dark:border-gray-700/50 flex items-center justify-center">
              <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" />
              <svg v-else class="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <h3 class="text-3xl font-bold text-gray-900 dark:text-white truncate" :title="displaySong.title || displaySong.name">{{ displaySong.title || displaySong.name }}</h3>
              <p class="text-lg text-gray-600 dark:text-gray-300 mt-3 truncate" :title="displaySong.artist">{{ displaySong.artist }}</p>
              <p class="text-base text-gray-500 dark:text-gray-400 mt-2 truncate" :title="displaySong.album">专辑：{{ displaySong.album }}</p>
              
              <div v-if="displaySong.is_various_artists_album" class="flex flex-wrap gap-2 mt-4">
                <span class="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                  群星合辑
                </span>
              </div>
            </div>
          </div>

          <!-- 下半部分：详细属性网格 -->
          <div class="flex flex-col gap-4">
            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-y-6 gap-x-4">
              <!-- 第一行 -->
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音轨号</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.track_number || '无' }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">碟号</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.disc_number || '无' }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">年份</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.year || '无' }}</div>
              </div>

              <!-- 第二行 -->
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音乐时长</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatDuration(displaySong.duration) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件大小</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSize(displaySong.file_size) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">格式</div>
                <div class="text-sm text-gray-800 dark:text-gray-200 uppercase">{{ displaySong.format || displaySong.container || '无' }}</div>
              </div>

              <!-- 第三行 -->
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">位深</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.bit_depth ? displaySong.bit_depth + ' bit' : '无' }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">采样率</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSampleRate(displaySong.sample_rate) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">比特率</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatBitrate(displaySong.bitrate) }}</div>
              </div>
            </div>

            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
              <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件路径</div>
              <div class="text-sm text-gray-800 dark:text-gray-200 break-all leading-snug">{{ displaySong.path }}</div>
            </div>

            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">添加时间</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(displaySong.added_at) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件修改时间</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(displaySong.file_modified_at) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部 -->
        <div class="px-6 py-4 bg-gray-50/80 dark:bg-white-[0.02] border-t border-gray-200/50 dark:border-gray-800 flex justify-between items-center shrink-0">
          <button
            @click="handleOpenFolder"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#ec4141] dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors"
          >
            <svg class="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
            打开文件所在目录
          </button>
          
          <button
            @click="handleClose"
            class="inline-flex justify-center px-6 py-2 text-sm font-medium text-white bg-[#ec4141] border border-transparent rounded-lg shadow-sm hover:bg-[#d73a3a] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#ec4141] transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
