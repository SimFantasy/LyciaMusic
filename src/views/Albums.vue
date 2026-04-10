<script setup lang="ts">
defineOptions({ name: 'Albums' });

import { computed, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { dragSession } from '../composables/dragState';
import { useCoverCache } from '../composables/useCoverCache';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import type { AlbumListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey } from '../utils/alphabetIndex';

const { filteredAlbumList, albumSortMode, updateAlbumOrder, searchQuery } = useLibraryBrowse();
const router = useRouter();
const { openHomeAlbum } = useHomeNavigation(router);
const isSearchActive = computed(() => searchQuery.value.trim().length > 0);

const showSortMenu = ref(false);
const dragOverKey = ref<string | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const displayedCoverUrls = reactive(new Map<string, string>());

const handleAlbumClick = (albumKey: string) => {
  void openHomeAlbum(albumKey);
};

const handleSortChange = (mode: 'count' | 'name' | 'artist' | 'custom') => {
  albumSortMode.value = mode;
  showSortMenu.value = false;
};

const { coverCache, isCoverLoading, preloadCovers } = useCoverCache();

const albumSections = computed(() => {
  const sections: Array<{
    key: string;
    items: Array<{ album: AlbumListItem; index: number }>;
  }> = [];

  filteredAlbumList.value.forEach((album, index) => {
    const key = getAlphabetIndexKey(album.name);
    const lastSection = sections[sections.length - 1];

    if (!lastSection || lastSection.key !== key) {
      sections.push({
        key,
        items: [{ album, index }],
      });
      return;
    }

    lastSection.items.push({ album, index });
  });

  return sections;
});

watch(
  () => filteredAlbumList.value,
  (newList) => {
    const paths = newList.map((album) => album.firstSongPath).filter(Boolean);

    const activePaths = new Set(paths);
    for (const existingPath of displayedCoverUrls.keys()) {
      if (!activePaths.has(existingPath)) {
        displayedCoverUrls.delete(existingPath);
      }
    }

    preloadCovers(paths);
  },
  { immediate: true },
);

watchEffect(() => {
  for (const album of filteredAlbumList.value) {
    const path = album.firstSongPath;
    if (!path) {
      continue;
    }

    const resolvedCoverUrl = coverCache.get(path);
    if (resolvedCoverUrl) {
      displayedCoverUrls.set(path, resolvedCoverUrl);
    }
  }
});

useListScrollMemory('albums-view', containerRef);

let mouseDownInfo: { x: number; y: number; index: number; album: AlbumListItem } | null = null;

const handleMouseDown = (event: MouseEvent, index: number, album: AlbumListItem) => {
  if (isSearchActive.value || event.button !== 0) {
    return;
  }

  mouseDownInfo = { x: event.clientX, y: event.clientY, index, album };
};

const handleGlobalMouseMove = (event: MouseEvent) => {
  if (!mouseDownInfo || dragSession.active) {
    return;
  }

  const dist = Math.hypot(event.clientX - mouseDownInfo.x, event.clientY - mouseDownInfo.y);
  if (dist <= 5) {
    return;
  }

  dragSession.active = true;
  dragSession.type = 'album';
  dragSession.data = { index: mouseDownInfo.index, key: mouseDownInfo.album.key };
};

const handleGlobalMouseUp = () => {
  if (dragSession.active && dragSession.type === 'album' && dragOverKey.value && mouseDownInfo) {
    const fromIndex = mouseDownInfo.index;
    const toIndex = filteredAlbumList.value.findIndex((album) => album.key === dragOverKey.value);

    if (toIndex !== -1 && fromIndex !== toIndex) {
      const list = [...filteredAlbumList.value];
      const [removed] = list.splice(fromIndex, 1);
      if (removed) {
        list.splice(toIndex, 0, removed);
        updateAlbumOrder(list.map((album) => album.key));
      }
    }
  }

  mouseDownInfo = null;
  if (dragSession.type === 'album') {
    dragSession.active = false;
    dragSession.type = 'song';
    dragSession.data = null;
    dragOverKey.value = null;
  }
};

const handleItemMouseMove = (_event: MouseEvent, albumKey: string) => {
  if (dragSession.active && dragSession.type === 'album') {
    dragOverKey.value = albumKey;
  }
};

const closeMenu = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.relative.z-50')) {
    showSortMenu.value = false;
  }
};

onMounted(() => {
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);
  window.addEventListener('click', closeMenu);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('mouseup', handleGlobalMouseUp);
  window.removeEventListener('click', closeMenu);
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent h-full min-h-0" @click="showSortMenu = false">
    <header class="h-auto px-6 pt-2 pb-3 shrink-0 select-none flex flex-col justify-center z-10 relative">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 pb-1">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">专辑列表</h2>
        </div>

        <div class="relative z-50 flex items-center gap-2">
          <button
            title="排序方式"
            class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
            @click.stop="showSortMenu = !showSortMenu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
          </button>

          <div v-if="showSortMenu" class="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
            <div class="py-1">
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'artist' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('artist')"
              >
                <span>按专辑艺人排序</span>
                <svg v-if="albumSortMode === 'artist'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('name')"
              >
                <span>按名称排序 (A-Z)</span>
                <svg v-if="albumSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('count')"
              >
                <span>按数量排序 (多->少)</span>
                <svg v-if="albumSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"
                :class="albumSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
              >
                <span>自定义排序 (拖拽触发)</span>
                <svg v-if="albumSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="containerRef" class="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar relative z-0">
      <div v-if="albumSortMode === 'name'" class="space-y-8">
        <section v-for="section in albumSections" :key="section.key" class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
              {{ section.key }}
            </div>
            <div class="h-px flex-1 bg-gradient-to-r from-gray-300/80 via-gray-200/50 to-transparent dark:from-white/15 dark:via-white/8 dark:to-transparent"></div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
            <div
              v-for="item in section.items"
              :key="item.album.key"
              class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5"
              :class="[
                dragSession.active && dragSession.type === 'album' && dragSession.data?.key === item.album.key ? 'opacity-50' : '',
                { 'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'album' && dragOverKey === item.album.key && dragSession.data?.key !== item.album.key },
              ]"
              @mousedown="handleMouseDown($event, item.index, item.album)"
              @mousemove="handleItemMouseMove($event, item.album.key)"
              @click="handleAlbumClick(item.album.key)"
            >
              <div class="relative w-full aspect-square mb-3 mt-4">
                <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
                </div>

                <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
                  <div
                    v-if="displayedCoverUrls.get(item.album.firstSongPath)"
                    class="w-full h-full bg-cover bg-center rounded-sm"
                    :style="{ backgroundImage: `url(${displayedCoverUrls.get(item.album.firstSongPath)})` }"
                  ></div>

                  <div
                    v-else
                    class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                    :class="{ 'animate-pulse': isCoverLoading(item.album.firstSongPath) }"
                  >
                    {{ item.album.name ? item.album.name.substring(0, 1).toUpperCase() : 'A' }}
                  </div>
                </div>
              </div>

              <div class="flex flex-col items-start px-1 z-20">
                <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
                  {{ item.album.name }}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
                  <span class="font-medium">{{ item.album.count }}首</span>
                  <span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span>
                  <span>{{ item.album.artist }}</span>
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
        <div
          v-for="(album, index) in filteredAlbumList"
          :key="album.key"
          class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5"
          :class="[
            dragSession.active && dragSession.type === 'album' && dragSession.data?.key === album.key ? 'opacity-50' : '',
            { 'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'album' && dragOverKey === album.key && dragSession.data?.key !== album.key },
          ]"
          @mousedown="handleMouseDown($event, index, album)"
          @mousemove="handleItemMouseMove($event, album.key)"
          @click="handleAlbumClick(album.key)"
        >
          <div class="relative w-full aspect-square mb-3 mt-4">
            <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
            </div>

            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
              <div
                v-if="displayedCoverUrls.get(album.firstSongPath)"
                class="w-full h-full bg-cover bg-center rounded-sm"
                :style="{ backgroundImage: `url(${displayedCoverUrls.get(album.firstSongPath)})` }"
              ></div>

              <div
                v-else
                class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                :class="{ 'animate-pulse': isCoverLoading(album.firstSongPath) }"
              >
                {{ album.name ? album.name.substring(0, 1).toUpperCase() : 'A' }}
              </div>
            </div>
          </div>

          <div class="flex flex-col items-start px-1 z-20">
            <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
              {{ album.name }}
            </h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
              <span class="font-medium">{{ album.count }}首</span>
              <span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span>
              <span>{{ album.artist }}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
