<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Song, SongDetail } from '../../types';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayer } from '../../composables/player';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import type { LyricsStorageSource } from '../../services/tauri/contracts';
import { tauriInvoke } from '../../services/tauri/invoke';

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
const lyricsText = ref('');
const originalLyricsText = ref('');
const lyricsSource = ref<LyricsStorageSource>('empty');
const lyricsSourcePath = ref<string | null>(null);
const isLyricsLoading = ref(false);
const isLyricsSaving = ref(false);
const lyricsError = ref('');
const isLyricsEditorExpanded = ref(false);
const pendingLyricsExpanded = ref<boolean | null>(null);
let detailRequestId = 0;
let lyricsExpandTimer: ReturnType<typeof window.setTimeout> | null = null;

const clearLyricsExpandTimers = () => {
  if (lyricsExpandTimer !== null) {
    window.clearTimeout(lyricsExpandTimer);
    lyricsExpandTimer = null;
  }
};

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
      clearLyricsExpandTimers();
      currentSongDetail.value = null;
      lyricsText.value = '';
      originalLyricsText.value = '';
      lyricsSource.value = 'empty';
      lyricsSourcePath.value = null;
      lyricsError.value = '';
      isLyricsLoading.value = false;
      isLyricsSaving.value = false;
      isLyricsEditorExpanded.value = false;
      pendingLyricsExpanded.value = null;
      setTimeout(() => {
        if (requestId === detailRequestId) {
          coverUrl.value = '';
        }
      }, 200);
      return;
    }

    clearLyricsExpandTimers();
    isClosing.value = false;
    isLyricsLoading.value = true;
    isLyricsSaving.value = false;
    lyricsSource.value = 'empty';
    lyricsSourcePath.value = null;
    lyricsError.value = '';
    isLyricsEditorExpanded.value = false;
    pendingLyricsExpanded.value = null;

    const [url, detail, lyricsResult] = await Promise.all([
      loadCover(path),
      loadSongDetail(path).catch(() => null),
      tauriInvoke('get_song_lyrics_for_edit', { path })
        .then((lyrics) => ({ ...lyrics, error: '' }))
        .catch((error) => ({
          lyrics: '',
          source: 'empty' as LyricsStorageSource,
          sourcePath: null,
          error: String(error),
        })),
    ]);

    if (requestId !== detailRequestId || !props.visible || path !== (props.song?.path ?? '')) {
      return;
    }

    coverUrl.value = url || '';
    currentSongDetail.value = detail;
    lyricsText.value = lyricsResult.lyrics;
    originalLyricsText.value = lyricsResult.lyrics;
    lyricsSource.value = lyricsResult.source;
    lyricsSourcePath.value = lyricsResult.sourcePath;
    lyricsError.value = lyricsResult.error;
    isLyricsLoading.value = false;
  },
  { immediate: true },
);

const hasLyricsChanged = computed(() => lyricsText.value !== originalLyricsText.value);
const isLyricsEditorVisuallyExpanded = computed(
  () => pendingLyricsExpanded.value ?? isLyricsEditorExpanded.value,
);

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearLyricsExpandTimers();
});

const handleOpenFolder = () => {
  if (props.song?.path) {
    void openInFinder(props.song.path);
    handleClose();
  }
};

const handleResetLyrics = () => {
  lyricsText.value = originalLyricsText.value;
};

const handleClearLyrics = () => {
  lyricsText.value = '';
};

const handleSaveLyrics = async () => {
  if (!props.song?.path || isLyricsSaving.value) return;

  isLyricsSaving.value = true;
  lyricsError.value = '';

  try {
    const savedLyrics = await tauriInvoke('save_song_lyrics', {
      path: props.song.path,
      lyrics: lyricsText.value,
      source: lyricsSource.value,
      sourcePath: lyricsSourcePath.value,
    });
    originalLyricsText.value = lyricsText.value;
    lyricsSource.value = savedLyrics.source;
    lyricsSourcePath.value = savedLyrics.sourcePath;
  } catch (error) {
    lyricsError.value = String(error);
  } finally {
    isLyricsSaving.value = false;
  }
};

const toggleLyricsEditorExpanded = () => {
  clearLyricsExpandTimers();

  const nextExpanded = !isLyricsEditorExpanded.value;
  pendingLyricsExpanded.value = nextExpanded;

  lyricsExpandTimer = window.setTimeout(() => {
    isLyricsEditorExpanded.value = nextExpanded;
    pendingLyricsExpanded.value = null;
    lyricsExpandTimer = null;
  }, 360);
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

      <div class="song-info-window-drag-strip" data-tauri-drag-region></div>

      <div
        class="song-info-stage"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          isLyricsEditorExpanded ? 'song-info-stage--lyrics-expanded' : '',
          pendingLyricsExpanded === true ? 'song-info-stage--lyrics-expanding' : '',
          pendingLyricsExpanded === false ? 'song-info-stage--lyrics-collapsing' : '',
        ]"
      >
        <!-- 模态框主体 -->
        <div
          class="song-info-main relative w-full bg-white/85 dark:bg-gray-900/90 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-white/40 dark:border-white/10"
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
          <div v-if="displaySong" class="song-info-content p-6 overflow-y-auto custom-scrollbar">
            <!-- 上半部分：封面 + 基本信息 -->
            <div class="song-info-hero flex flex-col sm:flex-row gap-6 mb-4">
              <div class="song-info-cover w-32 h-32 shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-md border border-gray-200/50 dark:border-gray-700/50 flex items-center justify-center">
                <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" />
                <svg v-else class="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>

              <div class="flex-1 min-w-0 flex flex-col justify-center">
                <h3 class="song-info-name text-3xl font-bold text-gray-900 dark:text-white truncate" :title="displaySong.title || displaySong.name">{{ displaySong.title || displaySong.name }}</h3>
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
              <div class="song-info-detail-grid bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-y-6 gap-x-4">
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

              <div class="song-info-time-grid bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div class="song-info-footer px-6 flex justify-between items-center shrink-0">
            <button
              @click="handleOpenFolder"
              class="modal-action-button modal-action-button--wide"
            >
              <svg class="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              打开文件所在目录
            </button>

            <button
              @click="handleClose"
              class="modal-action-button"
            >
              关闭
            </button>
          </div>
        </div>

        <aside class="lyrics-editor-panel" :class="isLyricsEditorVisuallyExpanded ? 'lyrics-editor-panel--expanded' : ''">
          <div class="lyrics-editor-header">
            <div class="lyrics-editor-heading">
              <div class="lyrics-editor-title" :class="isLyricsEditorVisuallyExpanded ? 'lyrics-editor-title--expanded' : ''">
                编辑歌词
              </div>
              <div
                v-if="displaySong"
                class="lyrics-editor-inline-song"
                :class="isLyricsEditorVisuallyExpanded ? '' : 'lyrics-editor-inline-song--hidden'"
              >
                <div class="lyrics-editor-cover">
                  <img v-if="coverUrl" :src="coverUrl" alt="" />
                  <svg v-else class="h-5 w-5 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-bold text-gray-900 dark:text-white" :title="displaySong.title || displaySong.name">
                    {{ displaySong.title || displaySong.name }}
                  </div>
                  <div class="truncate text-xs text-gray-500 dark:text-white/50" :title="displaySong.artist">
                    {{ displaySong.artist }}
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="lyrics-editor-expand-button"
              :title="isLyricsEditorVisuallyExpanded ? '还原歌词编辑器' : '放大歌词编辑器'"
              @click="toggleLyricsEditorExpanded"
            >
              <svg v-if="!isLyricsEditorVisuallyExpanded" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            </button>
          </div>

          <textarea
            v-model="lyricsText"
            class="lyrics-editor-textarea custom-scrollbar"
            :placeholder="isLyricsLoading ? '正在读取歌词...' : '[00:00.00] 在这里编辑 LRC 歌词'"
            :disabled="isLyricsLoading"
            spellcheck="false"
          ></textarea>

          <div v-if="lyricsError" class="lyrics-editor-error">{{ lyricsError }}</div>

          <div class="lyrics-editor-actions">
            <button type="button" class="modal-action-button" :disabled="!hasLyricsChanged || isLyricsSaving" @click="handleResetLyrics">
              恢复
            </button>
            <button type="button" class="modal-action-button" :disabled="!lyricsText || isLyricsSaving" @click="handleClearLyrics">
              清空
            </button>
            <button
              type="button"
              class="modal-action-button modal-action-button--primary"
              :disabled="!hasLyricsChanged || isLyricsSaving"
              @click="handleSaveLyrics"
            >
              {{ isLyricsSaving ? '保存中' : '保存' }}
            </button>
          </div>
        </aside>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}

.song-info-stage {
  --song-info-footer-height: clamp(76px, 10vh, 96px);
  --song-info-page-gap: clamp(12px, 1.3vw, 18px);
  --song-info-viewport-x: clamp(360px, 26vw, 520px);
  --song-info-viewport-y: clamp(200px, 24vh, 300px);
  --lyrics-panel-width: clamp(340px, 32vw, 460px);
  --song-info-main-width: min(680px, calc(100% - var(--lyrics-panel-width) - var(--song-info-page-gap)));
  position: relative;
  z-index: 2;
  display: flex;
  gap: var(--song-info-page-gap);
  width: min(1360px, calc(100vw - var(--song-info-viewport-x)));
  height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  transform-origin: center center;
  transition:
    gap 360ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 300ms ease,
    transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.song-info-window-drag-strip {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  height: clamp(56px, 9vh, 92px);
  cursor: default;
}

.song-info-content {
  flex: 1 1 auto;
  min-height: 0;
  padding: clamp(18px, 2.2vw, 24px);
}

.song-info-footer,
.lyrics-editor-actions {
  min-height: var(--song-info-footer-height);
}

.song-info-footer {
  padding-inline: clamp(18px, 2.2vw, 24px);
}

.song-info-hero {
  gap: clamp(16px, 2vw, 24px);
}

.song-info-cover {
  width: clamp(96px, 10vw, 128px);
  height: clamp(96px, 10vw, 128px);
}

.song-info-name {
  font-size: clamp(22px, 2.8vw, 30px);
  line-height: 1.18;
}

.song-info-detail-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(14px, 1.8vw, 24px) clamp(12px, 1.6vw, 16px);
}

.song-info-stage--lyrics-expanded,
.song-info-stage--lyrics-expanding {
  gap: 0;
}

.song-info-stage--lyrics-collapsing {
  gap: var(--song-info-page-gap);
}

.song-info-stage--lyrics-expanded .song-info-main,
.song-info-stage--lyrics-expanding .song-info-main {
  flex-basis: 0;
  width: 0;
  opacity: 0;
  transform: translateX(-18px);
  pointer-events: none;
}

.song-info-stage--lyrics-collapsing .song-info-main {
  flex-basis: var(--song-info-main-width);
  width: auto;
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.song-info-stage--lyrics-expanded .lyrics-editor-panel,
.song-info-stage--lyrics-expanding .lyrics-editor-panel {
  flex-basis: 100%;
}

.song-info-stage--lyrics-collapsing .lyrics-editor-panel {
  flex-basis: var(--lyrics-panel-width);
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea {
  scrollbar-width: none;
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea::-webkit-scrollbar,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.song-info-main,
.lyrics-editor-panel {
  min-height: 0;
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  transition:
    flex-basis 360ms cubic-bezier(0.4, 0, 0.2, 1),
    width 360ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 360ms cubic-bezier(0.4, 0, 0.2, 1),
    max-height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-info-main {
  flex: 0 1 var(--song-info-main-width);
  min-width: 0;
  overflow: hidden;
}

.song-info-stage--lyrics-expanded .lyrics-editor-panel {
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
}

.lyrics-editor-panel {
  flex: 1 1 var(--lyrics-panel-width);
  min-width: min(320px, 100%);
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.38);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  transform: translateX(0) scale(1);
  transition:
    flex-basis 360ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 360ms cubic-bezier(0.4, 0, 0.2, 1),
    max-height 360ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 160ms ease,
    background-color 160ms ease;
}

.lyrics-editor-panel--expanded {
  transform: translateX(0) scale(1);
}

:global(.dark) .lyrics-editor-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(17, 24, 39, 0.9);
}

.lyrics-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 72px;
  padding: 12px 72px 12px 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.lyrics-editor-heading {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.lyrics-editor-expand-button {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.68);
  color: rgb(75 85 99);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}

.lyrics-editor-expand-button:hover {
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}

:global(.dark) .lyrics-editor-expand-button {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.68);
}

:global(.dark) .lyrics-editor-expand-button:hover {
  border-color: rgba(236, 65, 65, 0.4);
  color: #ff8b8b;
}

:global(.dark) .lyrics-editor-header {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.lyrics-editor-title {
  flex-shrink: 0;
  color: rgb(17 24 39);
  font-size: 18px;
  font-weight: 800;
  line-height: 1.2;
}

:global(.dark) .lyrics-editor-title {
  color: rgb(255 255 255);
}

.lyrics-editor-inline-song {
  display: flex;
  align-items: center;
  gap: 12px;
  animation: lyrics-summary-in 160ms ease both;
}

.lyrics-editor-inline-song--hidden {
  opacity: 0;
  visibility: hidden;
}

.lyrics-editor-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.14);
}

.lyrics-editor-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lyrics-editor-textarea {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  min-height: 420px;
  resize: none;
  border: 0;
  background: transparent;
  padding: 18px;
  color: rgb(31 41 55);
  font-family: "Sarasa Gothic SC", "Sarasa Mono SC", "Sarasa Gothic", "Sarasa Mono", sans-serif;
  font-size: 13px;
  line-height: 1.7;
  outline: none;
}

.lyrics-editor-panel--expanded .lyrics-editor-textarea {
  min-height: 0;
}

.lyrics-editor-panel--expanded .lyrics-editor-actions {
  padding: 0 18px;
}

.modal-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 44px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  padding: 0 16px;
  color: rgb(55 65 81);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

@keyframes lyrics-summary-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .song-info-stage,
  .song-info-main,
  .lyrics-editor-panel {
    transition-duration: 0ms;
  }

  .lyrics-editor-inline-song {
    animation: none;
  }
}

:global(.dark) .lyrics-editor-textarea {
  color: rgba(255, 255, 255, 0.86);
}

.lyrics-editor-textarea::placeholder {
  color: rgb(156 163 175);
}

.lyrics-editor-error {
  margin: 0 18px 12px;
  border: 1px solid rgba(236, 65, 65, 0.22);
  border-radius: 12px;
  background: rgba(236, 65, 65, 0.08);
  padding: 10px 12px;
  color: #ec4141;
  font-size: 12px;
  line-height: 1.5;
}

.lyrics-editor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: var(--song-info-footer-height);
  padding: 0 18px;
  background: rgb(243 244 246);
}

:global(.dark) .lyrics-editor-actions {
  background: rgb(17 24 39);
}

.modal-action-button--wide {
  min-width: 184px;
}

.modal-action-button:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.38);
  color: #ec4141;
}

.modal-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.modal-action-button--primary {
  border-color: transparent;
  background: #ec4141;
  color: #fff;
}

:global(.dark) .modal-action-button {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
}

:global(.dark) .modal-action-button--primary {
  background: #ec4141;
  color: #fff;
}

@media (max-width: 1100px) {
  .song-info-stage {
    --song-info-footer-height: clamp(60px, 8vh, 76px);
    --song-info-viewport-x: clamp(180px, 24vw, 280px);
    --song-info-viewport-y: clamp(120px, 20vh, 190px);
    flex-direction: column;
    overflow-y: auto;
    width: min(100%, calc(100vw - var(--song-info-viewport-x)));
    height: calc(100dvh - var(--song-info-viewport-y));
    max-height: calc(100dvh - var(--song-info-viewport-y));
  }

  .song-info-stage--lyrics-expanded .song-info-main,
  .song-info-stage--lyrics-expanding .song-info-main {
    position: absolute;
    inset: 0;
  }

  .song-info-main,
  .lyrics-editor-panel {
    max-height: none;
  }

  .song-info-main,
  .song-info-stage--lyrics-collapsing .song-info-main {
    flex: 0 0 auto;
    width: 100%;
  }

  .lyrics-editor-panel,
  .song-info-stage--lyrics-collapsing .lyrics-editor-panel {
    flex: 0 0 min(440px, calc(100dvh - var(--song-info-viewport-y)));
    width: 100%;
    min-width: 0;
    min-height: 360px;
  }

  .song-info-stage--lyrics-expanded .lyrics-editor-panel,
  .song-info-stage--lyrics-expanding .lyrics-editor-panel {
    flex-basis: auto;
    max-height: calc(100dvh - var(--song-info-viewport-y));
    height: calc(100dvh - var(--song-info-viewport-y));
  }

  .lyrics-editor-textarea {
    min-height: 280px;
  }

  .lyrics-editor-panel--expanded .lyrics-editor-textarea {
    min-height: 0;
  }

  .lyrics-editor-panel--expanded .lyrics-editor-actions {
    padding: 0 18px;
  }

  .lyrics-editor-heading {
    gap: 12px;
  }
}

@media (max-width: 760px) {
  .song-info-stage {
    --song-info-viewport-x: clamp(96px, 20vw, 132px);
    --song-info-viewport-y: clamp(72px, 16vh, 112px);
    --song-info-footer-height: 58px;
    border-radius: 18px;
  }

  .song-info-hero {
    flex-direction: row;
    align-items: center;
    gap: 14px;
  }

  .song-info-cover {
    width: 84px;
    height: 84px;
  }

  .song-info-name {
    font-size: 22px;
  }

  .song-info-detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .song-info-footer,
  .lyrics-editor-actions {
    gap: 8px;
  }

  .modal-action-button {
    min-width: 76px;
    height: 38px;
    padding-inline: 11px;
    font-size: 13px;
  }

  .modal-action-button--wide {
    min-width: 152px;
  }
}

@media (max-width: 520px) {
  .song-info-stage {
    --song-info-viewport-x: 64px;
    --song-info-viewport-y: 56px;
    --song-info-footer-height: 56px;
    border-radius: 16px;
  }

  .song-info-content {
    padding: 12px;
  }

  .song-info-hero {
    gap: 10px;
  }

  .song-info-cover {
    width: 64px;
    height: 64px;
  }

  .song-info-detail-grid,
  .song-info-time-grid {
    grid-template-columns: 1fr;
  }

  .song-info-footer,
  .lyrics-editor-actions {
    justify-content: flex-end;
    padding-inline: 12px;
  }

  .modal-action-button--wide {
    min-width: 0;
  }

  .lyrics-editor-header {
    min-height: 58px;
    padding: 10px 58px 10px 14px;
  }

  .lyrics-editor-expand-button {
    top: 12px;
    right: 14px;
    width: 32px;
    height: 32px;
  }
}

@media (max-height: 720px) {
  .song-info-stage {
    --song-info-footer-height: 56px;
    --song-info-viewport-y: clamp(88px, 18vh, 140px);
  }

  .lyrics-editor-header {
    min-height: 62px;
    padding-block: 10px;
  }

  .lyrics-editor-textarea {
    min-height: 220px;
    padding-block: 14px;
  }

  .song-info-cover {
    width: clamp(84px, 12vh, 112px);
    height: clamp(84px, 12vh, 112px);
  }
}
</style>
