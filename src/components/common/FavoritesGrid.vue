<script setup lang="ts">
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { ref, watch, onUnmounted, nextTick } from 'vue';
import { useCoverCache } from '../../composables/useCoverCache';

const { favTab } = usePlayerViewState();
const { favArtistList, favAlbumList } = useLibraryBrowse();

const emit = defineEmits<{
  (e: 'enterDetail', type: 'artist' | 'album', name: string): void
}>();

const { coverCache, loadCover } = useCoverCache();

const ensureCoverLoaded = async (path: string) => {
  if (!path || coverCache.get(path)) return;
  try {
    await loadCover(path);
  } catch {}
};

const itemRefs = ref<HTMLElement[]>([]);
let observer: IntersectionObserver | null = null;

const initObserver = () => {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target as HTMLElement;
        const path = target.dataset.path;
        if (path) {
          void ensureCoverLoaded(path);
          observer?.unobserve(target);
        }
      }
    });
  }, { rootMargin: '100px' });

  itemRefs.value.forEach(el => {
    if (el) observer?.observe(el);
  });
};

watch([favArtistList, favAlbumList, favTab], async () => {
  await nextTick();
  initObserver();
}, { immediate: true, deep: true });

onUnmounted(() => {
  if (observer) observer.disconnect();
});
</script>

<template>
  <div class="favorites-grid p-4">
    <template v-if="favTab === 'artists'">
      <div
        v-for="artist in favArtistList"
        :key="artist.name"
        @click="emit('enterDetail', 'artist', artist.name)"
        class="group cursor-pointer"
      >
        <div
          ref="itemRefs"
          :data-path="artist.firstSongPath"
          class="relative aspect-square rounded-full overflow-hidden shadow-md
                 group-hover:shadow-xl transition-all duration-300 ease-out group-hover:scale-[1.03]"
        >
          <img
            v-if="coverCache.get(artist.firstSongPath)"
            :src="coverCache.get(artist.firstSongPath)"
            class="w-full h-full object-cover"
            alt="Artist"
          />

          <div v-else class="w-full h-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
            <span class="text-xl font-semibold text-indigo-300">艺人</span>
          </div>

          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          <div class="absolute inset-0 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300">
            <span class="font-bold text-sm truncate max-w-[80%] text-center drop-shadow-md">{{ artist.name }}</span>
            <span class="text-xs opacity-80 mt-1">{{ artist.count }} 首</span>
          </div>
        </div>

        <div class="mt-2 text-center">
          <span class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate block group-hover:text-[#EC4141] transition-colors">{{ artist.name }}</span>
          <span class="text-xs text-gray-400">{{ artist.count }} 首</span>
        </div>
      </div>
    </template>

    <template v-if="favTab === 'albums'">
      <div
        v-for="album in favAlbumList"
        :key="album.name"
        @click="emit('enterDetail', 'album', album.name)"
        class="group cursor-pointer"
      >
        <div
          ref="itemRefs"
          :data-path="album.firstSongPath"
          class="relative aspect-square rounded-lg overflow-hidden shadow-md
                 group-hover:shadow-xl transition-all duration-300 ease-out group-hover:scale-[1.03]"
        >
          <img
            v-if="coverCache.get(album.firstSongPath)"
            :src="coverCache.get(album.firstSongPath)"
            class="w-full h-full object-cover"
            alt="Album"
          />

          <div v-else class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <span class="text-xl font-semibold text-gray-300">专辑</span>
          </div>

          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          <div class="absolute inset-x-0 bottom-0 p-3 text-white">
            <span class="font-bold text-sm truncate block drop-shadow-md">{{ album.name }}</span>
            <span class="text-xs opacity-80 truncate block">{{ album.artist }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.favorites-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(3, 1fr);
}

@media (min-width: 640px) {
  .favorites-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
  }
}

@media (min-width: 1024px) {
  .favorites-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

@media (min-width: 1280px) {
  .favorites-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}
</style>
