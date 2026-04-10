import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, type Ref } from 'vue';
import { listScrollCache } from '../caches/imageCaches';

export function useListScrollMemory(key: string, containerRef: Ref<HTMLElement | null>) {
  const saveScrollPosition = () => {
    if (!containerRef.value) {
      return;
    }

    listScrollCache.set(key, containerRef.value.scrollTop);
  };

  const restoreScrollPosition = async () => {
    await nextTick();

    if (!containerRef.value) {
      return;
    }

    const savedTop = listScrollCache.get(key);
    if (savedTop === undefined) {
      return;
    }

    requestAnimationFrame(() => {
      if (containerRef.value) {
        containerRef.value.scrollTop = savedTop;
      }
    });
  };

  onMounted(() => {
    void restoreScrollPosition();
  });

  onActivated(() => {
    void restoreScrollPosition();
  });

  onDeactivated(() => {
    saveScrollPosition();
  });

  onBeforeUnmount(() => {
    saveScrollPosition();
  });

  return {
    saveScrollPosition,
    restoreScrollPosition,
  };
}
