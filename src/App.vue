<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watch } from 'vue';

import MainShell from './components/layout/MainShell.vue';
import MiniPlayerWindow from './components/layout/MiniPlayerWindow.vue';
import TrayMenuWindow from './components/layout/TrayMenuWindow.vue';
import DesktopLyricsWindow from './components/player/DesktopLyricsWindow.vue';
import { registerImportedLyricsFonts } from './composables/lyrics';
import { DESKTOP_LYRICS_WINDOW_LABEL } from './features/desktopLyrics/shared';
import { MINI_PLAYER_WINDOW_LABEL } from './features/miniPlayer/shared';
import { useSettings } from './features/settings/useSettings';
import { TRAY_MENU_WINDOW_LABEL } from './features/tray/actions';

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
})();

const isDesktopLyricsWindow = currentWindowLabel === DESKTOP_LYRICS_WINDOW_LABEL;
const isMiniPlayerWindow = currentWindowLabel === MINI_PLAYER_WINDOW_LABEL;
const isTrayMenuWindow = currentWindowLabel === TRAY_MENU_WINDOW_LABEL;

const { settings } = useSettings();
watch(
  () => settings.value.customLyricsFonts,
  (fonts) => registerImportedLyricsFonts(fonts),
  { deep: true, immediate: true },
);
</script>

<template>
  <DesktopLyricsWindow v-if="isDesktopLyricsWindow" />
  <MiniPlayerWindow v-else-if="isMiniPlayerWindow" />
  <TrayMenuWindow v-else-if="isTrayMenuWindow" />
  <MainShell v-else />
</template>

<style>
html,
body,
#app {
  -webkit-user-select: none;
  user-select: none;
}

input,
textarea,
[contenteditable="true"] {
  -webkit-user-select: text;
  user-select: text;
}
</style>
