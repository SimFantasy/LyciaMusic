<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { useSettings } from '../../features/settings/useSettings';
import { usePlayer } from '../../composables/player';
import { useToast } from '../../composables/toast';
import { useCoverCache } from '../../composables/useCoverCache';
import { clearPaletteCache } from '../../composables/colorExtraction';
import { clearImageCaches } from '../../caches/imageCaches';
import { appApi } from '../../services/tauri/appApi';
import type { AudioDevice, AudioOutputStatus } from '../../services/tauri/contracts';
import { playbackApi } from '../../services/tauri/playbackApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const OUTPUT_DEVICE_KEY = 'player_output_device';
const OUTPUT_DEVICE_MODE_KEY = 'player_output_device_mode';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();

const launchOnStartup = ref(false);
const gpuAcceleration = ref(true);
const autoPlay = ref(true);

const outputDevices = ref<AudioDevice[]>([]);
const selectedDeviceId = ref<string | null>(null);
const activeDeviceName = ref('');
const followsSystemDefault = ref(true);
const showDeviceMenu = ref(false);
const triggerButtonRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref({});
const showLyricsSyncOffsetPanel = ref(false);
const showClearAllDataConfirm = ref(false);
const isClearingAllData = ref(false);
const isClearingCache = ref(false);
let unlistenOutputStatus: (() => void) | null = null;
const { clearCoverCaches } = useCoverCache();

const isLibraryScanActive = computed(
  () => !!libraryScanProgress.value && !libraryScanProgress.value.done
);

const currentOutputDeviceLabel = computed(() => {
  if (activeDeviceName.value) {
    return activeDeviceName.value;
  }

  const selectedDevice = outputDevices.value.find(device => device.id === selectedDeviceId.value);
  return selectedDevice?.name || '默认系统设备';
});

const outputDeviceDescription = computed(() => {
  if (!currentOutputDeviceLabel.value) {
    return '未检测到可用输出设备';
  }

  return followsSystemDefault.value
    ? `当前播放设备：${currentOutputDeviceLabel.value}（跟随系统默认）`
    : `当前播放设备：${currentOutputDeviceLabel.value}`;
});

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

const applyOutputStatus = (status: AudioOutputStatus) => {
  selectedDeviceId.value = status.selected_device_id;
  activeDeviceName.value = status.active_device_name || '';
  followsSystemDefault.value = status.follows_system_default;
};

const fetchDevices = async () => {
  try {
    const devices = await playbackApi.getOutputDevices();
    outputDevices.value = devices;
  } catch (error) {
    console.error('Failed to get devices:', error);
  }
};

const fetchCurrentOutputStatus = async () => {
  try {
    const status = await playbackApi.getCurrentOutputDevice();
    applyOutputStatus(status);
  } catch (error) {
    console.error('Failed to get current output device:', error);
  }
};

const selectSystemDefaultDevice = async () => {
  try {
    await playbackApi.setOutputDevice(null);
    localStorage.removeItem(OUTPUT_DEVICE_KEY);
    localStorage.setItem(OUTPUT_DEVICE_MODE_KEY, 'default');
    showDeviceMenu.value = false;
    await fetchCurrentOutputStatus();
  } catch (error) {
    console.error('Failed to switch to system default device:', error);
  }
};

const selectDevice = async (device: AudioDevice) => {
  try {
    await playbackApi.setOutputDevice(device.id);
    localStorage.setItem(OUTPUT_DEVICE_KEY, device.id);
    localStorage.setItem(OUTPUT_DEVICE_MODE_KEY, 'manual');
    showDeviceMenu.value = false;
    await fetchCurrentOutputStatus();
  } catch (error) {
    console.error('Failed to set device:', error);
  }
};

const toggleDeviceMenu = () => {
  if (showDeviceMenu.value) {
    showDeviceMenu.value = false;
  } else {
    if (triggerButtonRef.value) {
      const rect = triggerButtonRef.value.getBoundingClientRect();
      dropdownStyle.value = {
        top: `${rect.bottom + 8}px`,
        left: `${rect.right - 224}px`,
        position: 'fixed',
        zIndex: 9999
      };
    }
    showDeviceMenu.value = true;
  }
};

onMounted(async () => {
  await Promise.all([fetchDevices(), fetchCurrentOutputStatus()]);
  unlistenOutputStatus = await listen<AudioOutputStatus>('audio-output-device-changed', async (event) => {
    applyOutputStatus(event.payload);
    await fetchDevices();
  });
});

onUnmounted(() => {
  unlistenOutputStatus?.();
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
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">系统启动时自动打开应用</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">使用显卡硬件加速界面渲染 (需要重启)</div>
          </div>
          <button @click="gpuAcceleration = !gpuAcceleration" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">最小化到系统托盘</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">点击最小化按钮时隐藏到托盘</div>
          </div>
          <button @click="settings.minimizeToTray = !settings.minimizeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.minimizeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.minimizeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭主面板时最小化到托盘</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">点击关闭按钮时隐藏到托盘，不退出程序</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示音质标识</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">在歌曲标题旁显示 Hi-Res / SQ / HQ 标签</div>
          </div>
          <button @click="settings.showQualityBadges = !settings.showQualityBadges" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showQualityBadges ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showQualityBadges ? 'translate-x-6' : 'translate-x-1'" />
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
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">程序启动后自动恢复上次播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors relative">
           <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">输出设备</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">
              {{ outputDeviceDescription }}
            </div>
          </div>
          
          <div class="relative">
            <button 
              ref="triggerButtonRef"
              @click="toggleDeviceMenu"
              class="text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition flex items-center gap-1"
            >
              <span class="max-w-[140px] truncate">{{ currentOutputDeviceLabel }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>

            <!-- Dropdown Teleport -->
            <Teleport to="body">
              <div v-if="showDeviceMenu">
                <!-- Overlay -->
                <div class="fixed inset-0 z-[9998]" @click="showDeviceMenu = false"></div>
                
                <!-- Menu -->
                <div 
                  class="fixed w-56 bg-white dark:bg-[#2b2b2b] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 py-1 z-[9999] animate-in fade-in zoom-in-95 duration-100"
                  :style="dropdownStyle"
                >
                  <button
                    @click="selectSystemDefaultDevice"
                    class="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center justify-between gap-3"
                    :class="followsSystemDefault ? 'text-[#EC4141] font-medium' : 'text-gray-600 dark:text-gray-300'"
                  >
                    <span class="min-w-0">
                      <span class="block truncate">跟随系统默认设备</span>
                      <span class="block truncate text-[11px] text-gray-500 dark:text-white/50">
                        {{ currentOutputDeviceLabel }}
                      </span>
                    </span>
                    <span v-if="followsSystemDefault" class="text-[#EC4141]">✓</span>
                  </button>
                  <div class="my-1 border-t border-gray-100 dark:border-white/10"></div>
                  <div v-if="outputDevices.length === 0" class="px-4 py-2 text-xs text-gray-400">未找到设备</div>
                  <button 
                    v-for="device in outputDevices" 
                    :key="device.id"
                    @click="selectDevice(device)"
                    class="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center justify-between group"
                    :class="!followsSystemDefault && selectedDeviceId === device.id ? 'text-[#EC4141] font-medium' : 'text-gray-600 dark:text-gray-300'"
                  >
                    <span class="truncate">{{ device.name }}</span>
                    <span v-if="!followsSystemDefault && selectedDeviceId === device.id" class="text-[#EC4141]">✓</span>
                  </button>
                </div>
              </div>
            </Teleport>
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
              <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5 truncate">
                当前值 {{ lyricsSyncOffsetLabel }}，点击展开调节
              </div>
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
          <div v-if="showLyricsSyncOffsetPanel" class="px-4 pb-4">
            <div class="pt-1 border-t border-white/30 dark:border-white/5">
        <div class="p-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="flex items-start justify-between gap-6">
            <div>
              <div class="text-xs text-gray-600 dark:text-white/60">
                正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。
              </div>
            </div>
          </div>

          <div class="mt-4 flex items-center gap-4">
            <input
              v-model="lyricsSyncOffsetMs"
              type="range"
              min="-1000"
              max="1000"
              step="10"
              class="flex-1 h-1.5 accent-[#EC4141] cursor-pointer"
            />
            <input
              v-model="lyricsSyncOffsetMs"
              type="number"
              min="-1000"
              max="1000"
              step="10"
              class="w-24 px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200"
            />
            <button
              @click="resetLyricsSyncOffset"
              class="shrink-0 text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition ml-auto"
            >
              恢复默认
            </button>
          </div>
        </div>
            </div>
          </div>
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
         <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除缓存</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">释放封面与界面取色缓存</div>
          </div>
          <button
            type="button"
            :disabled="isClearingCache"
            @click="handleClearCaches"
            class="text-xs px-3 py-1.5 border rounded transition"
            :class="isClearingCache
              ? 'bg-gray-100 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 cursor-not-allowed'
              : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-red-500 hover:border-red-500'"
          >
            {{ isClearingCache ? '清除中...' : '立即清除' }}
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        数据重置
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除所有数据</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">
              删除媒体库、播放记录、收藏和设置，恢复初始状态，不会删除你的音乐文件
            </div>
          </div>
          <button
            type="button"
            :disabled="isClearingAllData || isLibraryScanActive"
            @click="openClearAllDataConfirm"
            class="shrink-0 text-xs px-3 py-1.5 rounded border transition"
            :class="isClearingAllData || isLibraryScanActive
              ? 'bg-gray-100 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 cursor-not-allowed'
              : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-red-500 hover:border-red-500 hover:bg-red-50/60 dark:hover:bg-red-500/10'"
          >
            {{ isClearingAllData ? '正在清除...' : isLibraryScanActive ? '扫描中不可用' : '恢复初始状态' }}
          </button>
        </div>
      </div>
    </section>

    <ConfirmModal
      :visible="showClearAllDataConfirm"
      title="清除所有数据"
      content="此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？"
      @cancel="!isClearingAllData && (showClearAllDataConfirm = false)"
      @confirm="handleClearAllData"
    />
  </div>
</template>
