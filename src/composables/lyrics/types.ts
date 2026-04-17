import type {
  DesktopLyricsSettings,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsSettings,
} from '../../types';

export type {
  DesktopLyricsSettings,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsSettings,
};

export interface LyricLine {
  time: number;
  endTime: number;
  text: string;
  translation: string;
  romaji: string;
  words?: LyricWord[];
  secondary?: string[];
}

export interface LyricWord {
  text: string;
  start: number;
  end: number;
  romaji?: string;
}

export interface CurrentLyricDisplayLine {
  kind: 'main' | 'romaji' | 'translation';
  text: string;
  words?: LyricWord[];
}

export interface CurrentLyricDisplayState {
  text: string;
  lines: string[];
  displayLines: CurrentLyricDisplayLine[];
}

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type ParsedLineSourceFormat =
  | 'lrc'
  | 'enhanced_lrc'
  | 'eslrc'
  | 'yrc'
  | 'qrc'
  | 'lys'
  | 'ttml';

export interface ParsedWord {
  text: string;
  startMs: number;
  endMs: number;
  romanText?: string;
}

export type ExplicitLineRole = 'translation' | 'roman';

export interface ParsedLine {
  startMs: number;
  endMs?: number;
  text: string;
  words?: ParsedWord[];
  translatedText?: string;
  romanText?: string;
  sourceFormat: ParsedLineSourceFormat;
  sourceIndex: number;
  explicitRole?: ExplicitLineRole;
}

export type ClassificationConfidence = 'explicit' | 'parser-native' | 'heuristic';

export interface SemanticLine {
  startMs: number;
  endMs: number;
  mainText: string;
  mainWords?: ParsedWord[];
  translationText?: string;
  romanText?: string;
  romanWords?: ParsedWord[];
  secondaryTexts?: string[];
  confidence: ClassificationConfidence;
}

export interface DisplayFragment {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface RenderLine {
  startMs: number;
  endMs: number;
  main: DisplayFragment[];
  translation?: DisplayFragment[];
  roman?: DisplayFragment[];
  secondary?: DisplayFragment[];
}

export type DominantScript = 'latin' | 'han' | 'kana' | 'hangul' | 'mixed' | 'other';

export interface LineScriptProfile {
  latinCount: number;
  hanCount: number;
  kanaCount: number;
  hangulCount: number;
  dominantScript: DominantScript;
}

export interface ClassifiedGroupResult {
  main: ParsedLine;
  translationLine: ParsedLine | null;
  romajiLine: ParsedLine | null;
  secondaryLines: ParsedLine[];
  confidence: ClassificationConfidence;
}
