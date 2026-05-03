<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettings } from '../../features/settings/useSettings';
import { usePlayer } from '../../composables/player';
import { useToast } from '../../composables/toast';
import { useCoverCache } from '../../composables/useCoverCache';
import { clearPaletteCache } from '../../composables/colorExtraction';
import { clearImageCaches } from '../../caches/imageCaches';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import type { AudioOutputStatus } from '../../services/tauri/contracts';
import type { AudioDevice } from '../../services/tauri/contracts';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();

const launchOnStartup = ref(false);
const gpuAcceleration = ref(true);
const autoPlay = ref(true);
const showLyricsSyncOffsetPanel = ref(false);
const showClearAllDataConfirm = ref(false);
const isClearingAllData = ref(false);
const isClearingCache = ref(false);
const audioOutputStatus = ref<AudioOutputStatus | null>(null);
const audioOutputDevices = ref<AudioDevice[]>([]);
const selectedOutputDeviceId = ref<string>('');
const isChangingOutputDevice = ref(false);
let unlistenAudioOutput: UnlistenFn | null = null;
const { clearCoverCaches } = useCoverCache();

const isLibraryScanActive = computed(
  () => !!libraryScanProgress.value && !libraryScanProgress.value.done
);

const lyricsSyncOffsetMs = computed({
  get: () => Math.round(settings.value.lyricsSyncOffset * 1000),
  set: (value: number | string) => {
    const numericValue = typeof value === 'string' ? parseFloat(value) : value;
    const next = Number.isFinite(numericValue) ? Math.max(-1000, Math.min(1000, numericValue)) : 0;
    settings.value.lyricsSyncOffset = next / 1000;
  }
});

const lyricsSyncOffsetLabel = computed(() => {
  const offset = lyricsSyncOffsetMs.value;
  if (offset === 0) return '0 ms';
  return `${offset > 0 ? '+' : ''}${offset} ms`;
});

const isWasapiExclusiveEnabled = computed(
  () => settings.value.audio.outputMode === 'wasapiExclusive',
);

const audioOutputModeLabel = computed(() => {
  if (!audioOutputStatus.value) {
    return isWasapiExclusiveEnabled.value ? '独占' : '共享';
  }

  if (audioOutputStatus.value.active_output_mode === 'wasapiExclusive') {
    return '独占';
  }

  return audioOutputStatus.value.fallback_reason ? '共享（已回退）' : '共享';
});

const activeOutputDeviceLabel = computed(() =>
  audioOutputStatus.value?.active_device_name || '系统默认',
);

const loadAudioOutputDevices = async () => {
  const [devices, status] = await Promise.all([
    playbackApi.getOutputDevices(),
    playbackApi.getCurrentOutputDevice(),
  ]);

  audioOutputDevices.value = devices;
  audioOutputStatus.value = status;
  selectedOutputDeviceId.value = status.selected_device_id ?? '';
};

const handleOutputDeviceChange = async (event: Event) => {
  if (isChangingOutputDevice.value) {
    return;
  }

  const deviceId = (event.target as HTMLSelectElement).value;
  isChangingOutputDevice.value = true;

  try {
    const nextDeviceId = deviceId || null;
    await playbackApi.setOutputDevice(nextDeviceId);

    if (nextDeviceId) {
      playerStorage.setString(playerStorageKeys.outputDevice, nextDeviceId);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'manual');
    } else {
      playerStorage.remove(playerStorageKeys.outputDevice);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'default');
    }

    selectedOutputDeviceId.value = deviceId;
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output device:', error);
    showToast('切换播放设备失败', 'error');
    selectedOutputDeviceId.value = audioOutputStatus.value?.selected_device_id ?? '';
  } finally {
    isChangingOutputDevice.value = false;
  }
};

const toggleWasapiExclusive = async () => {
  const outputMode = isWasapiExclusiveEnabled.value ? 'shared' : 'wasapiExclusive';
  settings.value.audio.outputMode = outputMode;

  try {
    await playbackApi.setAudioOutputMode(outputMode);
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output mode:', error);
    showToast('切换音频输出模式失败', 'error');
  }
};

const resetLyricsSyncOffset = () => {
  lyricsSyncOffsetMs.value = 0;
};

const openClearAllDataConfirm = () => {
  if (isClearingAllData.value || isLibraryScanActive.value) {
    return;
  }

  showClearAllDataConfirm.value = true;
};

const handleClearAllData = async () => {
  if (isClearingAllData.value) {
    return;
  }

  isClearingAllData.value = true;

  try {
    await pauseSong().catch(() => {});
    await appApi.clearAllAppData();
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  } catch (error) {
    console.error('Failed to clear all app data:', error);
    showToast('清除所有数据失败，请重试', 'error');
    showClearAllDataConfirm.value = false;
    isClearingAllData.value = false;
  }
};

const handleClearCaches = async () => {
  if (isClearingCache.value) {
    return;
  }

  isClearingCache.value = true;

  try {
    await appApi.clearCoverCache();
    clearCoverCaches();
    clearImageCaches();
    clearPaletteCache();
    showToast('封面缓存已清除', 'success');
  } catch (error) {
    console.error('Failed to clear cover caches:', error);
    showToast('清除缓存失败，请重试', 'error');
  } finally {
    isClearingCache.value = false;
  }
};

onMounted(async () => {
  await loadAudioOutputDevices().catch(error => {
    console.warn('Failed to load audio output devices:', error);
  });
  unlistenAudioOutput = await listen<AudioOutputStatus>('audio-output-device-changed', event => {
    audioOutputStatus.value = event.payload;
    selectedOutputDeviceId.value = event.payload.selected_device_id ?? '';
  });
});

onScopeDispose(() => {
  unlistenAudioOutput?.();
  unlistenAudioOutput = null;
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
          </div>
          <button @click="gpuAcceleration = !gpuAcceleration" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭主面板时最小化到托盘</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示音质标识</div>
          </div>
          <button @click="settings.showQualityBadges = !settings.showQualityBadges" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showQualityBadges ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showQualityBadges ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">打开一键回顶按钮</div>
          </div>
          <button @click="settings.enableScrollToTopButton = !settings.enableScrollToTopButton" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.enableScrollToTopButton ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.enableScrollToTopButton ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- Playback -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        播放设置
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">自动播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放设备</div>
          </div>
          <div class="flex min-w-0 items-center gap-3">
            <span class="hidden max-w-[180px] truncate text-xs font-medium text-gray-600 dark:text-gray-300 md:inline">{{ activeOutputDeviceLabel }}</span>
            <select
              v-model="selectedOutputDeviceId"
              :disabled="isChangingOutputDevice"
              class="settings-select"
              @change="handleOutputDeviceChange"
            >
              <option value="">系统默认</option>
              <option
                v-for="device in audioOutputDevices"
                :key="device.id"
                :value="device.id"
              >
                {{ device.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">WASAPI 独占模式</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ audioOutputModeLabel }}</span>
            <button @click="toggleWasapiExclusive" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="isWasapiExclusiveEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="isWasapiExclusiveEnabled ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
        <div class="border-t border-white/30 dark:border-white/5">
          <button
            type="button"
            @click="showLyricsSyncOffsetPanel = !showLyricsSyncOffsetPanel"
            class="w-full p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors text-left"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词同步补偿</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-xs font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                {{ lyricsSyncOffsetLabel }}
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-gray-400 transition-transform duration-200"
                :class="showLyricsSyncOffsetPanel ? 'rotate-180' : ''"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
              </svg>
            </div>
          </button>
          <transition name="settings-pop-panel">
            <div v-if="showLyricsSyncOffsetPanel" class="px-4 pb-4">
              <div class="settings-expand-panel">
                <div class="text-xs leading-6 text-gray-600 dark:text-white/60">
                  正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。
                </div>

                <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                  <input
                    v-model="lyricsSyncOffsetMs"
                    type="range"
                    min="-1000"
                    max="1000"
                    step="10"
                    class="settings-slider flex-1"
                  />
                  <div class="flex items-center gap-3">
                    <input
                      v-model="lyricsSyncOffsetMs"
                      type="number"
                      min="-1000"
                      max="1000"
                      step="10"
                      class="settings-number-input"
                    />
                    <button
                      type="button"
                      @click="resetLyricsSyncOffset"
                      class="settings-action-button settings-action-button--soft"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </section>



    <!-- Storage -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        存储空间
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
         <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除缓存</div>
          </div>
          <button
            type="button"
            :disabled="isClearingCache"
            @click="handleClearCaches"
            class="settings-action-button"
            :class="isClearingCache
              ? 'settings-action-button--disabled'
              : 'settings-action-button--soft'"
          >
            {{ isClearingCache ? '清除中...' : '清除' }}
          </button>
        </div>
        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">重置数据</div>
          </div>
          <button
            type="button"
            :disabled="isClearingAllData || isLibraryScanActive"
            @click="openClearAllDataConfirm"
            class="settings-action-button shrink-0"
            :class="isClearingAllData || isLibraryScanActive
              ? 'settings-action-button--disabled'
              : 'settings-action-button--soft'"
          >
            {{ isClearingAllData ? '重置中...' : isLibraryScanActive ? '扫描中不可用' : '重置' }}
          </button>
        </div>
      </div>
    </section>

    <ConfirmModal
      :visible="showClearAllDataConfirm"
      title="重置数据"
      content="此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？"
      @cancel="!isClearingAllData && (showClearAllDataConfirm = false)"
      @confirm="handleClearAllData"
    />
  </div>
</template>

<style scoped>
.settings-expand-panel {
  margin-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding: 18px 16px 0;
}

.settings-slider {
  height: 6px;
  cursor: pointer;
  accent-color: #ec4141;
}

.settings-number-input {
  width: 98px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 12px;
  color: rgb(55 65 81);
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.3);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-select {
  max-width: 260px;
  min-height: 38px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 8px 12px;
  color: rgb(55 65 81);
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-select:focus {
  border-color: rgba(236, 65, 65, 0.3);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-select:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.settings-action-button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.settings-action-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-action-button--soft {
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

.settings-action-button--soft:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.settings-action-button--disabled {
  border-color: rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.36);
  color: rgba(100, 116, 139, 0.8);
  cursor: not-allowed;
  box-shadow: none;
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 240px;
}

:global(.dark) .settings-expand-panel {
  border-top-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .settings-number-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-select {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-select:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}
</style>
