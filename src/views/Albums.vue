<script setup lang="ts">
defineOptions({ name: 'Albums' });

import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { albumViewportCoverSnapshotCache } from '../caches/imageCaches';
import { dragSession } from '../composables/dragState';
import { useCoverCache } from '../composables/useCoverCache';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import type { AlbumListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey } from '../utils/alphabetIndex';

const { filteredAlbumList, albumSortMode, updateAlbumOrder, searchQuery } = useLibraryBrowse();
const router = useRouter();
const route = useRoute();
const { openHomeAlbum } = useHomeNavigation(router);
const isSearchActive = computed(() => searchQuery.value.trim().length > 0);
const { peekCoverUrl, touchCoverPaths, isCoverLoading, preloadPriorityCovers } = useCoverCache();

const showSortMenu = ref(false);
const dragOverKey = ref<string | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const containerScrollTop = ref(0);
const containerHeight = ref(720);
const containerWidth = ref(1200);
let coverObserver: IntersectionObserver | null = null;
let containerResizeObserver: ResizeObserver | null = null;
const VIEWPORT_SNAPSHOT_KEY = 'albums-current';
const VIEWPORT_SNAPSHOT_LIMIT = 72;
const ALBUM_GRID_GAP_X = 24;
const ALBUM_GRID_GAP_Y = 40;
const ALBUM_CARD_EXTRA_HEIGHT = 108;
const ALBUM_SECTION_HEADER_HEIGHT = 72;
const ALBUM_OVERSCAN_ROWS = 2;

const handleAlbumClick = (albumKey: string) => {
  void openHomeAlbum(albumKey);
};

const handleSortChange = (mode: 'count' | 'name' | 'artist' | 'custom') => {
  albumSortMode.value = mode;
  showSortMenu.value = false;
};

const getAlbumGridColumns = () => {
  if (window.innerWidth >= 1536) {
    return 7;
  }

  if (window.innerWidth >= 1280) {
    return 6;
  }

  if (window.innerWidth >= 1024) {
    return 5;
  }

  if (window.innerWidth >= 768) {
    return 4;
  }

  if (window.innerWidth >= 640) {
    return 3;
  }

  return 2;
};

const albumGridColumns = ref(getAlbumGridColumns());

const albumRowSpan = computed(() => {
  const columns = albumGridColumns.value;
  const width = Math.max(0, containerWidth.value - ALBUM_GRID_GAP_X * (columns - 1));
  const itemWidth = columns > 0 ? width / columns : containerWidth.value;
  return itemWidth + ALBUM_CARD_EXTRA_HEIGHT + ALBUM_GRID_GAP_Y;
});

const updateViewportMetrics = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
    containerWidth.value = containerRef.value.clientWidth;
  }

  albumGridColumns.value = getAlbumGridColumns();
};

const handleContainerScroll = (event: Event) => {
  containerScrollTop.value = (event.target as HTMLElement).scrollTop;
};

const getDisplayedCoverUrl = (path: string | undefined) => {
  if (!path) {
    return '';
  }

  return peekCoverUrl(path);
};

const restoreViewportCoverSnapshot = () => {
  const snapshot = albumViewportCoverSnapshotCache.get(VIEWPORT_SNAPSHOT_KEY);
  if (!snapshot || snapshot.length === 0) {
    return;
  }

  preloadPriorityCovers(snapshot);
};

const saveViewportCoverSnapshot = () => {
  if (!containerRef.value) {
    return;
  }

  const containerRect = containerRef.value.getBoundingClientRect();
  const viewportBuffer = containerRef.value.clientHeight;
  const snapshotTop = containerRect.top - viewportBuffer;
  const snapshotBottom = containerRect.bottom + viewportBuffer;
  const snapshot: string[] = [];
  const seenPaths = new Set<string>();

  containerRef.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    if (snapshot.length >= VIEWPORT_SNAPSHOT_LIMIT) {
      return;
    }

    const path = element.dataset.coverPath;
    if (!path || seenPaths.has(path)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < snapshotTop || rect.top > snapshotBottom) {
      return;
    }

    if (!getDisplayedCoverUrl(path)) {
      return;
    }

    seenPaths.add(path);
    snapshot.push(path);
  });

  if (snapshot.length > 0) {
    albumViewportCoverSnapshotCache.set(VIEWPORT_SNAPSHOT_KEY, snapshot);
    return;
  }

  albumViewportCoverSnapshotCache.delete(VIEWPORT_SNAPSHOT_KEY);
};

restoreViewportCoverSnapshot();

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

type AlbumSectionEntry = { album: AlbumListItem; index: number };
type AlbumVirtualHeaderRow = { type: 'header'; key: string; title: string };
type AlbumVirtualItemsRow = { type: 'items'; key: string; items: AlbumSectionEntry[] };
type AlbumVirtualRow = AlbumVirtualHeaderRow | AlbumVirtualItemsRow;

const groupedAlbumRows = computed<AlbumVirtualRow[]>(() => {
  const rows: AlbumVirtualRow[] = [];

  albumSections.value.forEach((section) => {
    rows.push({
      type: 'header',
      key: `header::${section.key}`,
      title: section.key,
    });

    for (let start = 0; start < section.items.length; start += albumGridColumns.value) {
      rows.push({
        type: 'items',
        key: `items::${section.key}::${start}`,
        items: section.items.slice(start, start + albumGridColumns.value),
      });
    }
  });

  return rows;
});

const groupedAlbumVirtualState = computed(() => {
  const overscanPx = albumRowSpan.value * ALBUM_OVERSCAN_ROWS;
  const startBoundary = Math.max(0, containerScrollTop.value - overscanPx);
  const endBoundary = containerScrollTop.value + containerHeight.value + overscanPx;

  let totalHeight = 0;
  let startIndex = 0;
  let endIndex = groupedAlbumRows.value.length;

  const measuredRows = groupedAlbumRows.value.map((row) => {
    const height = row.type === 'header' ? ALBUM_SECTION_HEADER_HEIGHT : albumRowSpan.value;
    const top = totalHeight;
    totalHeight += height;
    return {
      ...row,
      top,
      height,
    };
  });

  while (
    startIndex < measuredRows.length
    && measuredRows[startIndex].top + measuredRows[startIndex].height <= startBoundary
  ) {
    startIndex += 1;
  }

  endIndex = startIndex;
  while (endIndex < measuredRows.length && measuredRows[endIndex].top < endBoundary) {
    endIndex += 1;
  }

  const visibleRows = measuredRows.slice(startIndex, endIndex);
  const firstTop = visibleRows[0]?.top ?? 0;
  const lastBottom = visibleRows.length > 0
    ? visibleRows[visibleRows.length - 1].top + visibleRows[visibleRows.length - 1].height
    : 0;

  return {
    rows: visibleRows,
    paddingTop: `${firstTop}px`,
    paddingBottom: `${Math.max(0, totalHeight - lastBottom)}px`,
  };
});

const flatAlbumVirtualState = computed(() => {
  const totalRows = Math.ceil(filteredAlbumList.value.length / albumGridColumns.value);
  const startRow = Math.max(0, Math.floor(containerScrollTop.value / albumRowSpan.value) - ALBUM_OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows,
    Math.ceil((containerScrollTop.value + containerHeight.value) / albumRowSpan.value) + ALBUM_OVERSCAN_ROWS,
  );
  const startIndex = startRow * albumGridColumns.value;
  const endIndex = Math.min(filteredAlbumList.value.length, endRow * albumGridColumns.value);

  return {
    items: filteredAlbumList.value.slice(startIndex, endIndex).map((album, offset) => ({
      album,
      index: startIndex + offset,
    })),
    paddingTop: `${startRow * albumRowSpan.value}px`,
    paddingBottom: `${Math.max(0, (totalRows - endRow) * albumRowSpan.value)}px`,
  };
});

const visibleAlbumCoverPaths = computed(() => {
  if (albumSortMode.value === 'name') {
    return groupedAlbumVirtualState.value.rows.flatMap((row) => {
      if (row.type !== 'items') {
        return [];
      }

      return row.items
        .map(item => item.album.firstSongPath)
        .filter((path): path is string => !!path);
    });
  }

  return flatAlbumVirtualState.value.items
    .map(item => item.album.firstSongPath)
    .filter((path): path is string => !!path);
});

const initCoverObserver = async () => {
  await nextTick();

  if (coverObserver) {
    coverObserver.disconnect();
  }

  if (!containerRef.value) {
    return;
  }

  coverObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const target = entry.target as HTMLElement;
        const path = target.dataset.coverPath;
        if (path) {
          preloadPriorityCovers([path]);
        }
        coverObserver?.unobserve(target);
      });
    },
    {
      root: containerRef.value,
      rootMargin: '200px 0px',
    },
  );

  containerRef.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    coverObserver?.observe(element);
  });
};

const scrollMemoryKey = computed(
  () => ['albums-view', route.path, albumSortMode.value, searchQuery.value.trim()].join('::'),
);

useListScrollMemory(scrollMemoryKey, containerRef);

watch(
  [visibleAlbumCoverPaths, albumSortMode],
  ([paths]) => {
    touchCoverPaths(paths);
    preloadPriorityCovers(paths);
    void initCoverObserver();
  },
  { immediate: true, flush: 'post' },
);

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
  updateViewportMetrics();
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);
  window.addEventListener('click', closeMenu);
  window.addEventListener('resize', updateViewportMetrics);
  if (containerRef.value) {
    containerResizeObserver = new ResizeObserver(() => {
      updateViewportMetrics();
    });
    containerResizeObserver.observe(containerRef.value);
  }
  requestAnimationFrame(() => {
    void initCoverObserver();
  });
});

onBeforeUnmount(() => {
  saveViewportCoverSnapshot();
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('mouseup', handleGlobalMouseUp);
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('resize', updateViewportMetrics);
  if (containerResizeObserver) {
    containerResizeObserver.disconnect();
    containerResizeObserver = null;
  }
  if (coverObserver) {
    coverObserver.disconnect();
    coverObserver = null;
  }
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

    <section ref="containerRef" class="albums-scroll-container flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar relative z-0" @scroll="handleContainerScroll">
      <div
        v-if="albumSortMode === 'name'"
        :style="{ paddingTop: groupedAlbumVirtualState.paddingTop, paddingBottom: groupedAlbumVirtualState.paddingBottom }"
      >
        <template v-for="row in groupedAlbumVirtualState.rows" :key="row.key">
          <div
            v-if="row.type === 'header'"
            class="h-[72px] flex items-end gap-3 pb-4"
          >
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
              {{ row.title }}
            </div>
            <div class="h-px flex-1 bg-gradient-to-r from-gray-300/80 via-gray-200/50 to-transparent dark:from-white/15 dark:via-white/8 dark:to-transparent"></div>
          </div>

          <div
            v-else
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6"
            :style="{ paddingBottom: `${ALBUM_GRID_GAP_Y}px` }"
          >
            <div
              v-for="item in row.items"
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
              <div class="relative w-full aspect-square mb-3 mt-4" :data-cover-path="item.album.firstSongPath">
                <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
                </div>

                <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
                  <img
                    v-if="getDisplayedCoverUrl(item.album.firstSongPath)"
                    :src="getDisplayedCoverUrl(item.album.firstSongPath)"
                    :alt="item.album.name"
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                    class="w-full h-full rounded-sm object-cover select-none"
                  />

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
        </template>
      </div>

      <div
        v-else
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10"
        :style="{ paddingTop: flatAlbumVirtualState.paddingTop, paddingBottom: flatAlbumVirtualState.paddingBottom }"
      >
        <div
          v-for="item in flatAlbumVirtualState.items"
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
          <div class="relative w-full aspect-square mb-3 mt-4" :data-cover-path="item.album.firstSongPath">
            <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
            </div>

            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
              <img
                v-if="getDisplayedCoverUrl(item.album.firstSongPath)"
                :src="getDisplayedCoverUrl(item.album.firstSongPath)"
                :alt="item.album.name"
                loading="lazy"
                decoding="async"
                draggable="false"
                class="w-full h-full rounded-sm object-cover select-none"
              />

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
</template>

<style scoped>
.albums-scroll-container {
  overflow-anchor: none;
}
</style>
