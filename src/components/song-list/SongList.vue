<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import type { Song } from '../../types';
import { computed, watch, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
// 引用子组件
import SongTable from './SongTable.vue'; 
import SongListHeader from './SongListHeader.vue';
import MasterPanel from './MasterPanel.vue';
import AddToPlaylistModal from '../overlays/AddToPlaylistModal.vue';
import SongContextMenu from '../overlays/SongContextMenu.vue';
import ModernModal from '../common/ModernModal.vue';
import FavoritesGrid from '../common/FavoritesGrid.vue';
import DragGhost from '../common/DragGhost.vue';
import MoveToFolderModal from '../overlays/MoveToFolderModal.vue';
import { useToast } from '../../composables/toast';

// 🟢 新增 props: 允许隐藏内部 header
defineProps<{
  hideHeader?: boolean;
}>();

const route = useRoute();
const router = useRouter();

const { 
  songList, displaySongList, currentViewMode, 
  favTab, favDetailFilter, playSong, 
  addSongsToPlaylist, favoritePaths, moveFilesToFolder
} = usePlayer();

// 状态管理
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());


// --- 弹窗与右键菜单状态 ---
const showAddToPlaylistModal = ref(false);
const showMoveToFolderModal = ref(false);
const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

watch(isBatchMode, (val) => { if (!val) selectedPaths.value.clear(); });

// --- 业务逻辑处理 ---
const handleContextMenu = (e: MouseEvent, song: Song) => {
  if (isBatchMode.value) return; 
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  const menuHeight = 250;
  contextMenuY.value = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
  showContextMenu.value = true;
};

const handleBatchPlay = () => {
  const selected = displaySongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length > 0) playSong(selected[0]);
};

const executeBatchDelete = () => {
  if (currentViewMode.value === 'all' && route.path === '/') {
    const newPathSet = new Set(selectedPaths.value);
    songList.value = songList.value.filter(s => !newPathSet.has(s.path));
  } else if (route.path === '/favorites') {
    const newPathSet = new Set(selectedPaths.value);
    favoritePaths.value = favoritePaths.value.filter(p => !newPathSet.has(p));
  }
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  confirmMessage.value = `确定要移除选中的 ${selectedPaths.value.size} 首歌曲吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
};

const handleBatchMove = () => { if (selectedPaths.value.size > 0) showMoveToFolderModal.value = true; };
const confirmBatchMove = async (targetFolder: string, folderName: string) => {
  try {
    const paths = Array.from(selectedPaths.value);
    const count = await moveFilesToFolder(paths, targetFolder);
    useToast().showToast(`已成功移动 ${count} 首歌曲到 "${folderName}"`, 'success');
    showMoveToFolderModal.value = false; selectedPaths.value.clear();
  } catch (e: any) { 
    const msg = e.message || e;
    useToast().showToast("移动失败: " + msg, 'error'); 
  }
};

const handleAddToPlaylist = (playlistId: string) => {
  const songsToAdd = isBatchMode.value ? Array.from(selectedPaths.value) : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
  const addedCount = addSongsToPlaylist(playlistId, songsToAdd);
  showAddToPlaylistModal.value = false;
  const msg = addedCount === 0 ? "歌单内歌曲重复" : "已加入歌单";
  useToast().showToast(msg, addedCount === 0 ? 'info' : 'success');
};

// NOTE: 拖拽逻辑已统一迁移到 composables/useSongDrag.ts
// Home.vue / Recent.vue / Favorites.vue 通过 useSongDrag composable 使用拖拽功能

const enterFavDetail = (type: 'artist' | 'album', name: string) => { router.push({ query: { type, name } }); };
const isFavorites = computed(() => route.path === '/favorites');
const songTableMemoryScopeKey = computed(() =>
  [
    route.path,
    currentViewMode.value,
    favTab.value || '',
    favDetailFilter.value?.type || '',
    favDetailFilter.value?.name || '',
  ].join('::'),
);

// 监听 query 参数变化，控制详情页显隐
watch(() => route.query, (query) => {
  if (route.path === '/favorites') {
    if (query.type && query.name) {
      favDetailFilter.value = { type: query.type as 'artist' | 'album', name: query.name as string };
    } else {
      favDetailFilter.value = null;
    }
  }
}, { immediate: true });


// 🟢 Song Physical Delete Logic
const showSongPhysicalDeleteConfirm = ref(false);
const songToPhysicalDelete = ref<any>(null);

const { deleteFromDisk } = usePlayer(); // Import action

const handleSongPhysicalDelete = (song: any) => {
    songToPhysicalDelete.value = song;
    showSongPhysicalDeleteConfirm.value = true;
    showContextMenu.value = false;
};

const executeSongPhysicalDelete = async () => {
    if (songToPhysicalDelete.value) {
        await deleteFromDisk(songToPhysicalDelete.value);
        showSongPhysicalDeleteConfirm.value = false;
        songToPhysicalDelete.value = null;
    }
};

// 🟢 暴露给父组件使用的方法和状态
defineExpose({
  isBatchMode,
  selectedPaths,
  handleBatchPlay,
  requestBatchDelete,
  handleBatchMove,
  showAddToPlaylistModal
});
</script>

<template>
  <div class="flex-1 flex flex-col h-full bg-transparent relative transition-colors duration-500">
    <DragGhost /> 
    <SongListHeader 
      v-if="!hideHeader"
      v-model:isBatchMode="isBatchMode" 
      @batchPlay="handleBatchPlay" 
      @openAddToPlaylist="showAddToPlaylistModal = true" 
      @batchDelete="requestBatchDelete" 
      @batchMove="handleBatchMove" 
    />

    <div class="flex-1 flex overflow-hidden relative">
      <MasterPanel />

      <section class="flex-1 flex overflow-hidden">
        <FavoritesGrid v-if="isFavorites && !favDetailFilter && favTab !== 'songs'" @enterDetail="enterFavDetail"/>
        
        <SongTable 
          v-else
          :songs="displaySongList"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          :memoryScopeKey="songTableMemoryScopeKey"
          @play="playSong"
          @contextmenu="handleContextMenu"
        />
      </section>
    </div>
    
    <AddToPlaylistModal :visible="showAddToPlaylistModal" :selectedCount="isBatchMode ? selectedPaths.size : 1" @close="showAddToPlaylistModal = false" @add="handleAddToPlaylist"/>
    <MoveToFolderModal :visible="showMoveToFolderModal" :selectedCount="selectedPaths.size" @close="showMoveToFolderModal = false" @confirm="confirmBatchMove" />
    <SongContextMenu 
      :visible="showContextMenu" 
      :x="contextMenuX" 
      :y="contextMenuY" 
      :song="contextMenuTargetSong" 
      :is-playlist-view="currentViewMode === 'playlist'" 
      @close="showContextMenu = false" 
      @add-to-playlist="showAddToPlaylistModal = true"
      @delete-disk="handleSongPhysicalDelete"
    />
    <ModernModal :visible="showConfirm" title="移除歌曲" :content="confirmMessage" type="danger" confirm-text="移除" @confirm="executeBatchDelete" @cancel="showConfirm = false" />

    <!-- 🟢 Song Physical Delete Modal -->
    <ModernModal 
      v-model:visible="showSongPhysicalDeleteConfirm" 
      title="⚠️ 永久删除文件" 
      :content="`确定要从磁盘中永久删除歌曲 '${songToPhysicalDelete?.title}' 吗？此操作不可恢复！`" 
      type="danger"
      confirm-text="永久删除"
      @confirm="executeSongPhysicalDelete" 
    />
  </div>
</template>

<style scoped>
</style>
