<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { Song } from '../../types';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayer } from '../../composables/player';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits(['close']);

const { loadCover } = useCoverCache();
const { openInFinder } = usePlayer();

const coverUrl = ref('');
const isClosing = ref(false);

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
    isClosing.value = false;
  }, 200); // 时长匹配退出动画
};

watch(
  () => props.visible,
  async (newVal) => {
    if (newVal && props.song?.path) {
      isClosing.value = false;
      const url = await loadCover(props.song.path);
      coverUrl.value = url || '';
    } else {
      setTimeout(() => {
        coverUrl.value = '';
      }, 200);
    }
  }
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

// 格式化工具
const formatSize = (bytes?: number) => {
  if (!bytes) return '未知';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
};

const formatDuration = (ms?: number) => {
  if (!ms) return '未知';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatBitrate = (bitrate?: number) => {
  if (!bitrate) return '待扫描';
  return `${Math.round(bitrate / 1000)} kbps`;
};

const formatSampleRate = (rate?: number) => {
  if (!rate) return '未知';
  return `${(rate / 1000).toFixed(1)} kHz`;
};

const formatTime = (timestamp?: number) => {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
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
        <div v-if="song" class="p-6 overflow-y-auto custom-scrollbar">
          <!-- 上半部分：封面 + 基本信息 -->
          <div class="flex flex-col sm:flex-row gap-6 mb-8">
            <div class="w-32 h-32 shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-md border border-gray-200/50 dark:border-gray-700/50 flex items-center justify-center">
              <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" />
              <svg v-else class="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <h3 class="text-2xl font-bold text-gray-900 dark:text-white truncate" :title="song.title || song.name">{{ song.title || song.name }}</h3>
              <p class="text-base text-gray-600 dark:text-gray-300 mt-2 truncate" :title="song.artist">{{ song.artist }}</p>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate" :title="song.album">专辑：{{ song.album }}</p>
              
              <div class="flex flex-wrap gap-2 mt-3">
                <span v-if="song.format || song.container" class="px-2 py-0.5 text-xs font-semibold uppercase rounded bg-gray-100/80 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-black/5 dark:border-white/10">
                  {{ song.format || song.container }}
                </span>
                <span v-if="song.bit_depth || song.sample_rate" class="px-2 py-0.5 text-xs font-semibold rounded bg-[#ec4141]/10 text-[#ec4141] dark:bg-[#ec4141]/20 dark:text-[#ff8364] border border-[#ec4141]/20">
                  {{ song.bit_depth ? song.bit_depth + 'bit' : '' }} {{ song.sample_rate ? (song.sample_rate / 1000).toFixed(1) + 'kHz' : '' }}
                </span>
                <span v-if="song.is_various_artists_album" class="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                  群星合辑
                </span>
              </div>
            </div>
          </div>

          <!-- 下半部分：详细属性网格 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
              <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件路径</div>
              <div class="text-sm text-gray-800 dark:text-gray-200 break-all leading-snug">{{ song.path }}</div>
            </div>

            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
              <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音频质量</div>
              <div class="flex gap-4">
                <div>
                  <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatBitrate(song.bitrate) }}</div>
                </div>
                <div>
                  <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSampleRate(song.sample_rate) }}</div>
                </div>
                <div>
                  <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSize(song.file_size) }}</div>
                </div>
              </div>
            </div>

            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音乐时长</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatDuration(song.duration) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">年份</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ song.year || '未知' }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">流派</div>
                <div class="text-sm text-gray-800 dark:text-gray-200 truncate" :title="song.genre">{{ song.genre || '未知' }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">封装/编码</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ song.container || '未知' }} / {{ song.codec || '未知' }}</div>
              </div>
            </div>

            <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">添加时间</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(song.added_at) }}</div>
              </div>
              <div>
                <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件修改时间</div>
                <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(song.file_modified_at) }}</div>
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
