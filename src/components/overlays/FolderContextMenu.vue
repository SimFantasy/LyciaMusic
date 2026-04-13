<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  folderPath: string;
  selectedCount?: number;
  isManagementMode?: boolean;
  isRootFolder?: boolean;
}>();

const emit = defineEmits([
  'close',
  'play',
  'addToQueue',
  'createPlaylist',
  'openFolder',
  'remove',
  'refresh',
  'cancel',
  'delete-disk',
  'new-folder',
]);

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      if (menuRef.value) {
        menuSize.value = {
          width: menuRef.value.offsetWidth,
          height: menuRef.value.offsetHeight,
        };
      }
      return;
    }

    menuSize.value = { width: 0, height: 0 };
  },
);

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) {
    return {};
  }

  let top = props.y;
  let left = props.x;

  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
  }

  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
  }

  return {
    left: `${Math.max(8, left)}px`,
    top: `${Math.max(8, top)}px`,
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible',
  };
});

const handleClickOutside = (event: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('cancel');
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass =
  'px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors';
const sectionTitleClass = 'px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em] text-gray-400';
const enabledItemClass =
  'w-full px-4 py-2.5 text-left hover:bg-gray-100 cursor-pointer flex items-start group transition-colors';
const disabledItemClass =
  'w-full px-4 py-2.5 text-left flex items-start transition-colors cursor-not-allowed opacity-45';

const canRemoveFromLibrary = computed(() =>
  !!props.isManagementMode && !!props.isRootFolder,
);

const getManagementHint = (action: 'remove' | 'new-folder' | 'delete-disk') => {
  if (!props.isManagementMode) {
    return '仅管理模式可用';
  }

  if (action === 'remove' && !props.isRootFolder) {
    return '仅根目录可移除';
  }

  return '';
};

const emitIfAllowed = (
  eventName: 'remove' | 'new-folder' | 'delete-disk',
  allowed: boolean,
) => {
  if (!allowed) {
    return;
  }

  emit(eventName);
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9999] min-w-[180px] select-none rounded-lg border border-gray-100/50 bg-white/80 py-1.5 text-sm text-gray-700 shadow-xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-75"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <template v-if="selectedCount && selectedCount > 1">
        <div class="mb-1 border-b border-gray-100/50 px-4 py-2 text-xs text-gray-400">
          已选择 {{ selectedCount }} 个文件夹
        </div>
        <div
          class="flex cursor-pointer items-center px-4 py-2.5 text-[#EC4141] transition-colors hover:bg-gray-100"
          @click="emit('remove')"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <span>批量移除文件夹</span>
        </div>
      </template>

      <template v-else>
        <div :class="sectionTitleClass">浏览 / 播放</div>

        <div :class="itemClass" @click="emit('play')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
            </svg>
          </div>
          <span>播放</span>
        </div>

        <div :class="itemClass" @click="emit('addToQueue')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span>添加到播放队列</span>
        </div>

        <div class="my-1 h-px bg-gray-100"></div>

        <div :class="itemClass" @click="emit('createPlaylist')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span>创建为歌单</span>
        </div>

        <div :class="itemClass" @click="emit('openFolder')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span>打开所在目录</span>
        </div>

        <div class="my-1 h-px bg-gray-100"></div>

        <div :class="itemClass" @click="emit('refresh')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <span>刷新文件夹内容</span>
        </div>

        <div class="my-1 h-px bg-gray-100"></div>
        <div :class="sectionTitleClass">管理 / 危险</div>

        <button
          type="button"
          :class="canRemoveFromLibrary ? enabledItemClass : disabledItemClass"
          :disabled="!canRemoveFromLibrary"
          @click="emitIfAllowed('remove', canRemoveFromLibrary)"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center" :class="canRemoveFromLibrary ? 'text-gray-500 group-hover:text-gray-800' : 'text-gray-400'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
            </svg>
          </div>
          <div class="min-w-0">
            <div>从音乐库移除</div>
            <div v-if="getManagementHint('remove')" class="mt-0.5 text-[11px] text-gray-400">
              {{ getManagementHint('remove') }}
            </div>
          </div>
        </button>

        <button
          type="button"
          :class="isManagementMode ? enabledItemClass : disabledItemClass"
          :disabled="!isManagementMode"
          @click="emitIfAllowed('new-folder', !!isManagementMode)"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center" :class="isManagementMode ? 'text-gray-500 group-hover:text-gray-800' : 'text-gray-400'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div class="min-w-0">
            <div>新建文件夹</div>
            <div v-if="getManagementHint('new-folder')" class="mt-0.5 text-[11px] text-gray-400">
              {{ getManagementHint('new-folder') }}
            </div>
          </div>
        </button>

        <button
          type="button"
          :class="isManagementMode ? enabledItemClass : disabledItemClass"
          :disabled="!isManagementMode"
          @click="emitIfAllowed('delete-disk', !!isManagementMode)"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center" :class="isManagementMode ? 'text-[#EC4141]' : 'text-[#EC4141]/60'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6" />
            </svg>
          </div>
          <div class="min-w-0">
            <div :class="isManagementMode ? 'font-bold text-[#EC4141]' : 'font-bold text-[#EC4141]/70'">删除文件夹（本地）</div>
            <div v-if="getManagementHint('delete-disk')" class="mt-0.5 text-[11px] text-gray-400">
              {{ getManagementHint('delete-disk') }}
            </div>
          </div>
        </button>
      </template>
    </div>
  </Teleport>
</template>
