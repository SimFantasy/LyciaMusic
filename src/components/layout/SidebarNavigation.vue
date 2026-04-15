<script setup lang="ts">
interface SidebarSettings {
  showLocalMusic: boolean;
  showArtists: boolean;
  showAlbums: boolean;
  showFavorites: boolean;
  showRecent: boolean;
  showFolders: boolean;
  showStatistics: boolean;
}

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

defineProps<Props>();

defineEmits<{
  (event: 'openAll'): void;
  (event: 'openArtists'): void;
  (event: 'openAlbums'): void;
  (event: 'openFavorites'): void;
  (event: 'openRecent'): void;
  (event: 'openFolder'): void;
  (event: 'openStatistics'): void;
  (event: 'hoverArtists'): void;
  (event: 'hoverAlbums'): void;
}>();

const baseNavClasses = 'px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-300 text-sm font-medium active:scale-[0.97]';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm translate-x-1';
const inactiveNavClasses = 'text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white hover:translate-x-1';
</script>

<template>
  <ul class="space-y-1 transition-all duration-200" :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }">
    <template v-if="sidebar.showLocalMusic">
      <li @click="$emit('openAll')" :class="[baseNavClasses, (currentViewMode === 'all' && currentPath === '/') ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        <span>本地音乐</span>
      </li>
    </template>

    <template v-if="sidebar.showArtists">
      <li @click="$emit('openArtists')" @mouseenter="$emit('hoverArtists')" :class="[baseNavClasses, currentPath === '/artists' ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
        <span>歌手</span>
      </li>
    </template>

    <template v-if="sidebar.showAlbums">
      <li @click="$emit('openAlbums')" @mouseenter="$emit('hoverAlbums')" :class="[baseNavClasses, currentPath === '/albums' ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2" /><circle cx="12" cy="12" r="3" stroke-width="2" /></svg>
        <span>专辑</span>
      </li>
    </template>

    <template v-if="sidebar.showFavorites">
      <li @click="$emit('openFavorites')" :class="[baseNavClasses, currentPath === '/favorites' ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
        <span>我的收藏</span>
      </li>
    </template>

    <template v-if="sidebar.showRecent">
      <li @click="$emit('openRecent')" :class="[baseNavClasses, currentPath === '/recent' ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>最近播放</span>
      </li>
    </template>

    <template v-if="sidebar.showFolders">
      <li @click="$emit('openFolder')" :class="[baseNavClasses, (currentViewMode === 'folder' && currentPath === '/') ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
        <span>文件夹</span>
      </li>
    </template>

    <template v-if="sidebar.showStatistics">
      <li @click="$emit('openStatistics')" :class="[baseNavClasses, (currentViewMode === 'statistics' && currentPath === '/') ? activeNavClasses : inactiveNavClasses]">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        <span>统计</span>
      </li>
    </template>
  </ul>
</template>
