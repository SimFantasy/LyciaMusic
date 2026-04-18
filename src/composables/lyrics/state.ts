import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import { buildLyricDocument, lyricDocumentToSemanticLines } from './classifier';
import { getCurrentLyricDisplayLines, semanticLineToLyricLine } from './converters';
import { prepareParsedLyrics } from './parser';
import type {
  CurrentLyricDisplayState,
  DesktopLyricsSettings,
  LyricLine,
  LyricDocument,
  LyricsSettings,
  LyricsStatus,
  SemanticLine,
} from './types';

export const showDesktopLyrics = ref(false);
export const showLyricsPlayerSettingsPanel = ref(false);
export const lyricsStatus = ref<LyricsStatus>('idle');
export const parsedLyrics = ref<LyricLine[]>([]);
export const lyricDocument = ref<LyricDocument | null>(null);

const rawLyrics = ref('');
const semanticLyrics = ref<SemanticLine[]>([]);
let loadRequestId = 0;

function createSettingsProxy<T extends object>(
  read: () => T,
  patch: (patch: Partial<T>) => void,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      return read()[property as keyof T];
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return false;
      patch({ [property]: value } as Partial<T>);
      return true;
    },
    has(_target, property) {
      return property in read();
    },
    ownKeys() {
      return Reflect.ownKeys(read());
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true,
      };
    },
  });
}

export const lyricsSettings = createSettingsProxy<LyricsSettings>(
  () => useLyricsSettingsStore().lyricsSettings,
  (patch) => useLyricsSettingsStore().patchLyricsSettings(patch),
);

export const desktopLyricsSettings = createSettingsProxy<DesktopLyricsSettings>(
  () => useLyricsSettingsStore().desktopLyricsSettings,
  (patch) => useLyricsSettingsStore().patchDesktopLyricsSettings(patch),
);

async function parseLyrics(raw: string): Promise<{
  document: LyricDocument | null;
  semanticLines: SemanticLine[];
  displayLines: LyricLine[];
}> {
  const parsed = await prepareParsedLyrics(raw);
  if (parsed.length === 0) {
    return {
      document: null,
      semanticLines: [],
      displayLines: [],
    };
  }

  const document = buildLyricDocument(parsed);
  const semanticLines = lyricDocumentToSemanticLines(document);

  return {
    document,
    semanticLines,
    displayLines: semanticLines.map(semanticLineToLyricLine),
  };
}

export async function loadLyrics() {
  const requestId = ++loadRequestId;
  const playbackStore = usePlaybackStore();
  const song = playbackStore.currentSong;

  if (!song) {
    rawLyrics.value = '';
    lyricDocument.value = null;
    semanticLyrics.value = [];
    parsedLyrics.value = [];
    lyricsStatus.value = 'idle';
    return;
  }

  lyricsStatus.value = 'loading';
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];

  try {
    const lrc = await invoke<string>('get_song_lyrics', { path: song.path });

    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

    rawLyrics.value = lrc || '';
    const parsed = await parseLyrics(rawLyrics.value);
    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

    lyricDocument.value = parsed.document;
    semanticLyrics.value = parsed.semanticLines;
    parsedLyrics.value = parsed.displayLines;
    lyricsStatus.value = parsedLyrics.value.length > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

    rawLyrics.value = '';
    lyricDocument.value = null;
    semanticLyrics.value = [];
    parsedLyrics.value = [];
    lyricsStatus.value = 'error';
    console.error('Failed to load lyrics:', error);
  }
}

function findLyricIndexByTime(lines: LyricLine[], targetTime: number): number {
  let left = 0;
  let right = lines.length - 1;
  let answer = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (lines[mid].time <= targetTime) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return answer;
}

export const currentLyricIndex = computed(() => {
  if (parsedLyrics.value.length === 0) return -1;

  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay;
  return findLyricIndexByTime(parsedLyrics.value, targetTime);
});

export const currentLyricLine = computed<CurrentLyricDisplayState>(() => {
  if (lyricsStatus.value === 'loading') {
    return {
      text: 'Loading lyrics...',
      lines: ['Loading lyrics...'],
      displayLines: [{ kind: 'main', text: 'Loading lyrics...' }],
    };
  }

  if (lyricsStatus.value === 'error') {
    return {
      text: 'Lyrics unavailable',
      lines: ['Lyrics unavailable'],
      displayLines: [{ kind: 'main', text: 'Lyrics unavailable' }],
    };
  }

  if (parsedLyrics.value.length === 0) {
    const fallback = rawLyrics.value.trim() ? 'No synchronized lyrics' : 'Instrumental / No lyrics';
    return {
      text: fallback,
      lines: [fallback],
      displayLines: [{ kind: 'main', text: fallback }],
    };
  }

  const index = currentLyricIndex.value;

  if (index !== -1) {
    const current = parsedLyrics.value[index];
    const displayLines = getCurrentLyricDisplayLines(
      current,
      lyricsSettings.showTranslation,
      lyricsSettings.showRomaji,
    );

    return {
      text: current.text,
      lines: displayLines.map((line) => line.text),
      displayLines,
    };
  }

  const first = parsedLyrics.value[0];
  return {
    text: first.text,
    lines: [first.text],
    displayLines: [{ kind: 'main', text: first.text }],
  };
});

export function useLyrics() {
  return {
    showDesktopLyrics,
    showLyricsPlayerSettingsPanel,
    lyricsSettings,
    desktopLyricsSettings,
    lyricsStatus,
    currentLyricLine,
    currentLyricIndex,
    parsedLyrics,
    lyricDocument,
    loadLyrics,
    semanticLyrics,
  };
}
