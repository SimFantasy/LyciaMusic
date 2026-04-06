import { computed, ref, watch, type Ref } from 'vue';

interface UseHomeViewStateOptions {
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  isManagementMode: Ref<boolean>;
}

export function useHomeViewState({
  currentViewMode,
  filterCondition,
  isManagementMode,
}: UseHomeViewStateOptions) {
  const localViewMode = ref(currentViewMode.value);
  const localFilterCondition = ref(filterCondition.value);
  const artistActiveTab = ref<'songs' | 'albums' | 'details'>('songs');

  const viewTransitionKey = computed(
    () => `${localViewMode.value}:${localFilterCondition.value}`,
  );

  watch(
    currentViewMode,
    newMode => {
      localViewMode.value = newMode;
      if (newMode !== 'artist') {
        artistActiveTab.value = 'songs';
      }
      if (newMode !== 'folder') {
        isManagementMode.value = false;
      }
    },
    { immediate: true },
  );

  watch(
    filterCondition,
    newFilter => {
      localFilterCondition.value = newFilter;
    },
    { immediate: true },
  );

  return {
    localViewMode,
    localFilterCondition,
    artistActiveTab,
    viewTransitionKey,
  };
}
