<template>
  <div class="flex flex-col h-full">
    <RecentHeader
      v-model:isBatchMode="isBatchMode"
      :selectedCount="selectedPaths.size"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @addToPlaylist="showAddToPlaylistModal = true"
      @batchDelete="requestBatchDelete"
      @clearHistory="handleClearHistory"
      @addAllToQueue="handleAddAllToQueue"
    />
    
    <div class="flex-1 flex overflow-hidden relative">
      
      <section class="flex-1 flex overflow-hidden">
        <SongTable
          ref="songTableRef"
          :songs="localSongList"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          memoryScopeKey="recent-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @update:selectedPaths="selectedPaths = $event"
          @drag-start="handleTableDragStart"
        />
      </section>
    </div>
    
    <!-- 弹窗组件 -->
    <DragGhost />
    
    <AddToPlaylistModal 
      :visible="showAddToPlaylistModal" 
      :selectedCount="isBatchMode ? selectedPaths.size : 1" 
      @close="showAddToPlaylistModal = false" 
      @add="handleAddToPlaylist"
    />
    
    <SongContextMenu 
      :visible="showContextMenu" 
      :x="contextMenuX" 
      :y="contextMenuY" 
      :song="contextMenuTargetSong" 
      :is-playlist-view="false" 
      @close="showContextMenu = false" 
      @add-to-playlist="showAddToPlaylistModal = true"
    />
    
    <ModernModal 
      :visible="showConfirm" 
      title="删除记录" 
      :content="confirmMessage" 
      type="danger" 
      confirm-text="删除" 
      @confirm="executeConfirmAction" 
      @cancel="showConfirm = false" 
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Song } from '../types';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useToast } from '../composables/toast';

// 组件导入
import RecentHeader from '../components/headers/RecentHeader.vue';
import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import AddToPlaylistModal from '../components/overlays/AddToPlaylistModal.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import ModernModal from '../components/common/ModernModal.vue';
import { useSongDrag } from '../composables/useSongDrag';

const { displaySongList, searchQuery } = usePlayerLibraryView();
const { playSong, addSongsToQueue } = usePlaybackController();
const {
  addSongsToPlaylist,
  removeFromHistory,
  clearHistory,
} = useLibraryCollections();

const localSongList = computed(() => displaySongList.value);

// ========== 状态管理 ==========
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);

// 初始化拖拽逻辑
const { handleTableDragStart } = useSongDrag(localSongList, isBatchMode, selectedPaths, songTableRef);

// 弹窗状态
const showAddToPlaylistModal = ref(false);
const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// 监听批量模式变化，清空选择
watch(isBatchMode, (val) => { if (!val) selectedPaths.value.clear(); });

// ========== 业务逻辑处理 ==========

// 播放全部
const handlePlayAll = () => {
  if (localSongList.value.length > 0) {
    void playSong(localSongList.value[0]);
  }
};

const handlePlaySong = (song: Song) => {
  const shouldInsertAfterCurrent = searchQuery.value.trim().length > 0;
  void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
};

const handleAddAllToQueue = () => {
  addSongsToQueue(localSongList.value);
};

// 批量播放
const handleBatchPlay = () => {
  const selected = localSongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length > 0) {
    void playSong(selected[0]);
  }
};

// 批量删除（从最近播放移除）
const executeBatchDelete = async () => {
  const newPathSet = new Set(selectedPaths.value);
  await removeFromHistory(Array.from(newPathSet));
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  confirmMessage.value = `确定要删除选中的 ${selectedPaths.value.size} 条播放记录吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
};

const executeConfirmAction = async () => {
  await confirmAction.value();
  showConfirm.value = false;
};

// 清空历史
const handleClearHistory = () => {
  confirmMessage.value = "确定要清空所有播放记录吗？";
  confirmAction.value = async () => {
    await clearHistory();
    showConfirm.value = false;
  };
  showConfirm.value = true;
};

// 添加到歌单
const handleAddToPlaylist = (playlistId: string) => {
  const songsToAdd = isBatchMode.value 
    ? Array.from(selectedPaths.value) 
    : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
  const addedCount = addSongsToPlaylist(playlistId, songsToAdd);
  showAddToPlaylistModal.value = false;
  const msg = addedCount === 0 ? "歌单内歌曲重复" : "已加入歌单";
  useToast().showToast(msg, addedCount === 0 ? 'info' : 'success');
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, song: Song) => {
  if (isBatchMode.value) return; 
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  const menuHeight = 250;
  contextMenuY.value = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
  showContextMenu.value = true;
};

// ========== 路由监听 ==========
</script>
