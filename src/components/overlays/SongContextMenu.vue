<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';
import { useRoute } from 'vue-router';

import { usePlayer } from '../../composables/player';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useToast } from '../../composables/toast';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import type { Song } from '../../types';

type SongMenuAction =
  | 'play'
  | 'playNext'
  | 'addToQueueTail'
  | 'addToPlaylist'
  | 'viewArtist'
  | 'viewAlbum'
  | 'openFolder'
  | 'viewSongInfo'
  | 'removeFromList'
  | 'deleteFromDisk';

type SongMenuEntry =
  | { type: 'divider'; key: string }
  | { type: 'action'; key: SongMenuAction; label: string; danger?: boolean };

interface SongMenuIcon {
  fill?: boolean;
  viewBox?: string;
  paths: Array<{
    d: string;
    fillRule?: 'evenodd' | 'nonzero' | 'inherit';
    clipRule?: 'evenodd' | 'nonzero' | 'inherit';
  }>;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  song: Song | null;
  isPlaylistView: boolean;
  isFolderView?: boolean;
  isManagementMode?: boolean;
}>();

const emit = defineEmits(['close', 'add-to-playlist', 'delete-disk']);

const route = useRoute();
const { showToast } = useToast();
const { playSong, playNext, addSongToQueue, removeSongFromList, openInFinder, currentViewMode } = usePlayer();
const { removeFromPlaylist } = useLibraryCollections();
const { filterCondition } = usePlayerViewState();

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

const showDeleteFromDisk = computed(() => Boolean(props.isFolderView && props.isManagementMode));

const menuIcons: Record<SongMenuAction, SongMenuIcon> = {
  play: {
    fill: true,
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M8 5v14l11-7z',
      },
    ],
  },
  playNext: {
    fill: true,
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 7.5A1.5 1.5 0 017.26 6.2L16 12l-8.74 5.8A1.5 1.5 0 015 16.5v-9zM18 6h2v12h-2z',
      },
    ],
  },
  addToQueueTail: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M4 7h10', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M4 12h10', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M4 17h6', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M16 14v6', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M13 17h6', fillRule: 'evenodd', clipRule: 'evenodd' },
    ],
  },
  addToPlaylist: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M4 12h8', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M8 8v8', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M4 6h14', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M14 12h4' },
      { d: 'M14 18h6' },
    ],
  },
  viewArtist: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7z' },
      { d: 'M5 19a7 7 0 0114 0' },
    ],
  },
  viewAlbum: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 19a7 7 0 100-14 7 7 0 000 14z' },
      { d: 'M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
      { d: 'M12 7.5v-1' },
    ],
  },
  openFolder: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M3.75 7.5A2.25 2.25 0 016 5.25h4.19c.4 0 .78.16 1.06.44l1.06 1.06c.28.28.66.44 1.06.44H18A2.25 2.25 0 0120.25 9.5v7A2.25 2.25 0 0118 18.75H6a2.25 2.25 0 01-2.25-2.25v-9z' },
    ],
  },
  viewSongInfo: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 10.5v5' },
      { d: 'M12 7.75h.01' },
      { d: 'M12 20a8 8 0 100-16 8 8 0 000 16z' },
    ],
  },
  removeFromList: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 12h14', fillRule: 'evenodd', clipRule: 'evenodd' },
      { d: 'M4.5 7h15' },
      { d: 'M4.5 17h15' },
    ],
  },
  deleteFromDisk: {
    fill: false,
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 7h14' },
      { d: 'M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7' },
      { d: 'M8 10.5v5.5' },
      { d: 'M12 10.5v5.5' },
      { d: 'M16 10.5v5.5' },
      { d: 'M6.5 7l.7 10.3A2 2 0 009.2 19h5.6a2 2 0 001.99-1.7L17.5 7' },
    ],
  },
};

const menuEntries = computed<SongMenuEntry[]>(() => {
  const entries: SongMenuEntry[] = [
    { type: 'action', key: 'play', label: '播放' },
    { type: 'action', key: 'playNext', label: '下一首播放' },
    { type: 'action', key: 'addToQueueTail', label: '添加到队尾' },
    { type: 'divider', key: 'divider-primary' },
    { type: 'action', key: 'addToPlaylist', label: '收藏到歌单' },
    { type: 'action', key: 'viewArtist', label: '查看艺人' },
    { type: 'action', key: 'viewAlbum', label: '查看专辑' },
    { type: 'divider', key: 'divider-secondary' },
    { type: 'action', key: 'openFolder', label: '打开文件所在目录' },
    { type: 'action', key: 'viewSongInfo', label: '查看歌曲信息' },
    { type: 'divider', key: 'divider-danger' },
    { type: 'action', key: 'removeFromList', label: '从列表移除' },
  ];

  if (showDeleteFromDisk.value) {
    entries.push({ type: 'action', key: 'deleteFromDisk', label: '从本地移除', danger: true });
  }

  return entries;
});

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

const handleGlobalClick = (event: MouseEvent) => {
  if (props.visible && menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

const showPlaceholderToast = (label: string) => {
  showToast(`${label}功能暂未开放`, 'info');
};

const handleRemoveFromList = () => {
  if (!props.song) {
    return;
  }

  if (props.isPlaylistView) {
    removeFromPlaylist(filterCondition.value, props.song.path);
    return;
  }

  if (route.path === '/favorites' || route.path === '/recent' || currentViewMode.value === 'all') {
    void removeSongFromList(props.song);
    return;
  }

  showToast('当前页面暂不支持从列表移除', 'info');
};

const handleAction = (action: SongMenuAction) => {
  if (!props.song) {
    return;
  }

  switch (action) {
    case 'play':
      void playSong(props.song);
      break;
    case 'playNext':
      playNext(props.song);
      break;
    case 'addToQueueTail':
      addSongToQueue(props.song);
      break;
    case 'addToPlaylist':
      emit('add-to-playlist');
      break;
    case 'viewArtist':
      showPlaceholderToast('查看艺人');
      break;
    case 'viewAlbum':
      showPlaceholderToast('查看专辑');
      break;
    case 'openFolder':
      void openInFinder(props.song.path);
      break;
    case 'viewSongInfo':
      showPlaceholderToast('查看歌曲信息');
      break;
    case 'removeFromList':
      handleRemoveFromList();
      break;
    case 'deleteFromDisk':
      emit('delete-disk', props.song);
      break;
  }

  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9999] min-w-[220px] select-none rounded-lg border border-gray-100/50 bg-white/80 py-1.5 text-sm text-gray-700 shadow-xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-75"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <template v-for="entry in menuEntries" :key="entry.key">
        <div v-if="entry.type === 'divider'" class="my-1 h-px bg-gray-100"></div>
        <div
          v-else
          class="flex cursor-pointer items-center px-4 py-2.5 transition-colors hover:bg-gray-100"
          :class="entry.danger ? 'text-[#EC4141] hover:text-[#d73a3a]' : ''"
          @click="handleAction(entry.key)"
        >
          <div class="mr-3 flex h-4 w-4 shrink-0 items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              :viewBox="menuIcons[entry.key].viewBox || '0 0 24 24'"
              :fill="menuIcons[entry.key].fill ? 'currentColor' : 'none'"
              :stroke="menuIcons[entry.key].fill ? 'none' : 'currentColor'"
              :stroke-width="menuIcons[entry.key].fill ? undefined : '1.8'"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                v-for="(path, pathIndex) in menuIcons[entry.key].paths"
                :key="`${entry.key}-${pathIndex}`"
                :d="path.d"
                :fill-rule="path.fillRule"
                :clip-rule="path.clipRule"
              />
            </svg>
          </div>
          <span>{{ entry.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>
