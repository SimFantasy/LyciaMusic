<script setup lang="ts">
defineOptions({ name: 'Artists' });

import { computed, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { dragSession } from '../composables/dragState';
import { useCoverCache } from '../composables/useCoverCache';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import type { ArtistListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey } from '../utils/alphabetIndex';

const { filteredArtistList, artistSortMode, updateArtistOrder, searchQuery } = useLibraryBrowse();
const router = useRouter();
const { openHomeArtist } = useHomeNavigation(router);
const isSearchActive = computed(() => searchQuery.value.trim().length > 0);

const showSortMenu = ref(false);
const dragOverName = ref<string | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const displayedCoverUrls = reactive(new Map<string, string>());

const handleArtistClick = (artistName: string) => {
  void openHomeArtist(artistName);
};

const handleSortChange = (mode: 'count' | 'name' | 'custom') => {
  artistSortMode.value = mode;
  showSortMenu.value = false;
};

const { coverCache, isCoverLoading, preloadCovers } = useCoverCache();

const artistSections = computed(() => {
  const sections: Array<{
    key: string;
    items: Array<{ artist: ArtistListItem; index: number }>;
  }> = [];

  filteredArtistList.value.forEach((artist, index) => {
    const key = getAlphabetIndexKey(artist.name);
    const lastSection = sections[sections.length - 1];

    if (!lastSection || lastSection.key !== key) {
      sections.push({
        key,
        items: [{ artist, index }],
      });
      return;
    }

    lastSection.items.push({ artist, index });
  });

  return sections;
});

watch(
  () => filteredArtistList.value,
  (newList) => {
    const paths = newList.map((artist) => artist.firstSongPath).filter(Boolean);

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
  for (const artist of filteredArtistList.value) {
    const path = artist.firstSongPath;
    if (!path) {
      continue;
    }

    const resolvedCoverUrl = coverCache.get(path);
    if (resolvedCoverUrl) {
      displayedCoverUrls.set(path, resolvedCoverUrl);
    }
  }
});

useListScrollMemory('artists-view', containerRef);

const gradients = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-cyan-500 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-fuchsia-500 to-pink-500',
  'from-blue-400 to-indigo-500',
  'from-violet-500 to-purple-500',
];

const getGradientForArtist = (name: string) => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
};

let mouseDownInfo: { x: number; y: number; index: number; artist: ArtistListItem } | null = null;

const handleMouseDown = (event: MouseEvent, index: number, artist: ArtistListItem) => {
  if (isSearchActive.value || event.button !== 0) {
    return;
  }

  mouseDownInfo = { x: event.clientX, y: event.clientY, index, artist };
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
  dragSession.type = 'artist';
  dragSession.data = { index: mouseDownInfo.index, name: mouseDownInfo.artist.name };
};

const handleGlobalMouseUp = () => {
  if (dragSession.active && dragSession.type === 'artist' && dragOverName.value && mouseDownInfo) {
    const fromIndex = mouseDownInfo.index;
    const toIndex = filteredArtistList.value.findIndex((artist) => artist.name === dragOverName.value);

    if (toIndex !== -1 && fromIndex !== toIndex) {
      const list = [...filteredArtistList.value];
      const [removed] = list.splice(fromIndex, 1);
      if (removed) {
        list.splice(toIndex, 0, removed);
        updateArtistOrder(list.map((artist) => artist.name));
      }
    }
  }

  mouseDownInfo = null;
  if (dragSession.type === 'artist') {
    dragSession.active = false;
    dragSession.type = 'song';
    dragSession.data = null;
    dragOverName.value = null;
  }
};

const handleItemMouseMove = (_event: MouseEvent, artistName: string) => {
  if (dragSession.active && dragSession.type === 'artist') {
    dragOverName.value = artistName;
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
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">歌手列表</h2>
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
                :class="artistSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('name')"
              >
                <span>按名称排序 (A-Z)</span>
                <svg v-if="artistSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="artistSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('count')"
              >
                <span>按数量排序 (多->少)</span>
                <svg v-if="artistSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"
                :class="artistSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
              >
                <span>自定义排序 (拖拽触发)</span>
                <svg v-if="artistSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="containerRef" class="flex-1 overflow-y-auto p-8 custom-scrollbar relative z-0">
      <div v-if="artistSortMode === 'name'" class="space-y-8">
        <section v-for="section in artistSections" :key="section.key" class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
              {{ section.key }}
            </div>
            <div class="h-px flex-1 bg-gradient-to-r from-gray-300/80 via-gray-200/50 to-transparent dark:from-white/15 dark:via-white/8 dark:to-transparent"></div>
          </div>

          <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-4">
            <div
              v-for="item in section.items"
              :key="item.artist.name"
              class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-colors relative select-none"
              :class="[
                dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === item.artist.name ? 'opacity-50' : '',
              ]"
              @mousedown="handleMouseDown($event, item.index, item.artist)"
              @mousemove="handleItemMouseMove($event, item.artist.name)"
              @click="handleArtistClick(item.artist.name)"
            >
              <div
                class="relative w-12 h-12 md:w-14 md:h-14 shrink-0"
                :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#222222] rounded-full': dragSession.active && dragSession.type === 'artist' && dragOverName === item.artist.name && dragSession.data?.name !== item.artist.name }"
              >
                <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                  <div v-if="isCoverLoading(item.artist.firstSongPath)" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
                  <img v-else-if="displayedCoverUrls.get(item.artist.firstSongPath)" :src="displayedCoverUrls.get(item.artist.firstSongPath)" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="item.artist.name">
                  <div v-else class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="getGradientForArtist(item.artist.name)">
                    {{ item.artist.name.charAt(0).toUpperCase() }}
                  </div>
                  <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div>
                </div>
              </div>

              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">
                  {{ item.artist.name }}
                </h3>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-4">
        <div
          v-for="(artist, index) in filteredArtistList"
          :key="artist.name"
          class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-colors relative select-none"
          :class="[
            dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === artist.name ? 'opacity-50' : '',
          ]"
          @mousedown="handleMouseDown($event, index, artist)"
          @mousemove="handleItemMouseMove($event, artist.name)"
          @click="handleArtistClick(artist.name)"
        >
          <div
            class="relative w-12 h-12 md:w-14 md:h-14 shrink-0"
            :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#222222] rounded-full': dragSession.active && dragSession.type === 'artist' && dragOverName === artist.name && dragSession.data?.name !== artist.name }"
          >
            <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center">
              <div v-if="isCoverLoading(artist.firstSongPath)" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
              <img v-else-if="displayedCoverUrls.get(artist.firstSongPath)" :src="displayedCoverUrls.get(artist.firstSongPath)" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="artist.name">
              <div v-else class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="getGradientForArtist(artist.name)">
                {{ artist.name.charAt(0).toUpperCase() }}
              </div>
              <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div>
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">
              {{ artist.name }}
            </h3>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
