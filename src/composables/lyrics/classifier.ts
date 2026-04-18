import type {
  ClassificationConfidence,
  DominantScript,
  LineScriptProfile,
  LyricDocument,
  LyricTrack,
  LyricTrackLine,
  LyricTrackRole,
  ParsedLine,
  ParsedLineSourceFormat,
  ParsedWord,
  SemanticLine,
} from './types';

const MAX_GROUP_TOLERANCE_MS = 50;
const MAX_GROUP_SIZE = 3;
const ALIGNMENT_HIGH_WINDOW_MS = 300;
const ALIGNMENT_MEDIUM_WINDOW_MS = 800;
const ALIGNMENT_LOW_WINDOW_MS = 1500;
const MIN_TRACK_MATCH_SCORE = 2.6;
const ENGLISH_HINT_WORDS = new Set([
  'a',
  'all',
  'am',
  'and',
  'are',
  'be',
  'care',
  'do',
  'for',
  'had',
  'have',
  'hello',
  'i',
  'in',
  'is',
  'it',
  'know',
  'love',
  'me',
  'my',
  'not',
  'of',
  'on',
  'that',
  'the',
  'there',
  'to',
  'want',
  'we',
  'with',
  'you',
  'your',
]);
const ROMANIZATION_PATTERN = /(shi|chi|tsu?|kyo|ryo|ryu|nya|hya|gya|sha|sya|jya|ja|yeo|gye|sarang|geudae|uri|nani|kimo|kimi|watashi|boku|anata|kara|made|desu|xiang|zh|ch|sh|ang|eng|ing|ong|iao|ian|uan|uang|yuan|yin|ying|xin|meng)/i;

type TrackRoleHint = Extract<LyricTrackRole, 'translation' | 'romanization'>;

interface CandidateLine extends LyricTrackLine {
  sourceFormat: ParsedLineSourceFormat;
  scriptProfile: LineScriptProfile;
}

interface TrackAlignmentPair {
  mainIndex: number;
  auxIndex: number;
  driftMs: number;
  quality: number;
}

interface TrackAlignment {
  pairs: TrackAlignmentPair[];
  mainCoverage: number;
  auxCoverage: number;
  weightedScore: number;
}

interface TrackRoleScores {
  main: number;
  translation: number;
  romanization: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveDominantScript(profile: Omit<LineScriptProfile, 'dominantScript'>): DominantScript {
  const counts = [
    ['latin', profile.latinCount],
    ['han', profile.hanCount],
    ['kana', profile.kanaCount],
    ['hangul', profile.hangulCount],
  ] as const;
  const total = counts.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) return 'other';

  const sorted = [...counts].sort((left, right) => right[1] - left[1]);
  const [dominantScript, dominantCount] = sorted[0];
  const secondaryCount = sorted[1]?.[1] ?? 0;

  if (secondaryCount > 0 && dominantCount / total < 0.7) {
    return 'mixed';
  }

  return dominantScript;
}

export function getLineScriptProfile(text: string): LineScriptProfile {
  const baseProfile = {
    latinCount: 0,
    hanCount: 0,
    kanaCount: 0,
    hangulCount: 0,
  };

  for (const char of text) {
    if (/\p{Script=Latin}/u.test(char)) {
      baseProfile.latinCount += 1;
      continue;
    }
    if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(char)) {
      baseProfile.kanaCount += 1;
      continue;
    }
    if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(char)) {
      baseProfile.hangulCount += 1;
      continue;
    }
    if (/\p{Script=Han}/u.test(char)) {
      baseProfile.hanCount += 1;
    }
  }

  return {
    ...baseProfile,
    dominantScript: resolveDominantScript(baseProfile),
  };
}

function mapExplicitRoleToTrackRole(role?: LyricTrackLine['explicitRole']): TrackRoleHint | undefined {
  if (role === 'translation') return 'translation';
  if (role === 'roman') return 'romanization';
  return undefined;
}

function extractRomanizedWords(words?: ParsedWord[]): ParsedWord[] | undefined {
  if (!words || words.length === 0) return undefined;

  const romanWords = words
    .filter((word) => (word.romanText || '').trim().length > 0)
    .map((word) => ({
      text: word.romanText || '',
      startMs: word.startMs,
      endMs: word.endMs,
    }));

  return romanWords.length > 0 ? romanWords : undefined;
}

function createCandidateLine(options: {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: ParsedWord[];
  sourceFormat: ParsedLineSourceFormat;
  sourceIndex: number;
  explicitRole?: LyricTrackLine['explicitRole'];
  roleSource: ClassificationConfidence;
}): CandidateLine | null {
  const text = options.text.trim();
  if (!text) return null;

  return {
    id: options.id,
    startMs: options.startMs,
    endMs: Math.max(options.startMs, options.endMs),
    text,
    words: options.words && options.words.length > 0 ? options.words : undefined,
    sourceFormat: options.sourceFormat,
    sourceIndex: options.sourceIndex,
    explicitRole: options.explicitRole,
    roleSource: options.roleSource,
    scriptProfile: getLineScriptProfile(text),
  };
}

function buildCandidateLines(lines: ParsedLine[]): CandidateLine[] {
  const candidates: CandidateLine[] = [];

  lines.forEach((line, index) => {
    const lineEndMs = Math.max(line.startMs, line.endMs ?? line.startMs);
    const baseCandidate = createCandidateLine({
      id: `parsed:${index}:main`,
      startMs: line.startMs,
      endMs: lineEndMs,
      text: line.text,
      words: line.words,
      sourceFormat: line.sourceFormat,
      sourceIndex: line.sourceIndex,
      explicitRole: line.explicitRole,
      roleSource: line.explicitRole ? 'explicit' : 'heuristic',
    });

    if (baseCandidate) candidates.push(baseCandidate);

    const translationCandidate = createCandidateLine({
      id: `parsed:${index}:translation`,
      startMs: line.startMs,
      endMs: lineEndMs,
      text: line.translatedText || '',
      sourceFormat: line.sourceFormat,
      sourceIndex: line.sourceIndex + 0.1,
      explicitRole: 'translation',
      roleSource: 'parser-native',
    });

    if (translationCandidate) candidates.push(translationCandidate);

    const romanWords = extractRomanizedWords(line.words);
    const romanText = (line.romanText || '').trim() || romanWords?.map((word) => word.text).join('');
    const romanCandidate = createCandidateLine({
      id: `parsed:${index}:roman`,
      startMs: line.startMs,
      endMs: lineEndMs,
      text: romanText || '',
      words: romanWords,
      sourceFormat: line.sourceFormat,
      sourceIndex: line.sourceIndex + 0.2,
      explicitRole: 'roman',
      roleSource: romanText || romanWords ? 'parser-native' : 'heuristic',
    });

    if (romanCandidate) candidates.push(romanCandidate);
  });

  return candidates.sort((left, right) => (
    (left.startMs - right.startMs)
    || (left.sourceIndex - right.sourceIndex)
    || (left.endMs - right.endMs)
  ));
}

function isJapaneseLikeProfile(profile: LineScriptProfile): boolean {
  return profile.kanaCount > 0 && profile.hangulCount === 0;
}

function getScriptFamily(script: DominantScript): 'latin' | 'cjk' | 'hangul' | 'other' {
  if (script === 'latin') return 'latin';
  if (script === 'han' || script === 'kana' || script === 'mixed') return 'cjk';
  if (script === 'hangul') return 'hangul';
  return 'other';
}

function getEffectiveTolerance(
  currentStartMs: number,
  prevStartMs: number | null,
  nextStartMs: number | null,
): number {
  const prevGap = prevStartMs !== null
    ? Math.abs(currentStartMs - prevStartMs)
    : Number.POSITIVE_INFINITY;
  const nextGap = nextStartMs !== null
    ? Math.abs(nextStartMs - currentStartMs)
    : Number.POSITIVE_INFINITY;

  return Math.min(
    MAX_GROUP_TOLERANCE_MS,
    prevGap * 0.25,
    nextGap * 0.25,
  );
}

function findContextStart(
  lines: CandidateLine[],
  originIndex: number,
  direction: -1 | 1,
): number | null {
  const originStartMs = lines[originIndex].startMs;

  for (let index = originIndex + direction; index >= 0 && index < lines.length; index += direction) {
    const candidateStartMs = lines[index].startMs;
    if (Math.abs(candidateStartMs - originStartMs) > MAX_GROUP_TOLERANCE_MS) {
      return candidateStartMs;
    }
  }

  return null;
}

function getGroupTolerance(lines: CandidateLine[], groupStartIndex: number): number {
  return getEffectiveTolerance(
    lines[groupStartIndex].startMs,
    findContextStart(lines, groupStartIndex, -1),
    findContextStart(lines, groupStartIndex, 1),
  );
}

function shouldKeepSeparateForScriptSimilarity(group: CandidateLine[], candidate: CandidateLine): boolean {
  if (candidate.startMs === group[0]?.startMs) {
    return false;
  }

  if ([...group, candidate].some((line) => line.explicitRole)) {
    return false;
  }

  if (isJapaneseLikeProfile(candidate.scriptProfile)) {
    return group.some((line) => isJapaneseLikeProfile(line.scriptProfile));
  }

  const candidateScript = candidate.scriptProfile.dominantScript;
  if (candidateScript === 'mixed' || candidateScript === 'other') return false;

  return group.some((line) => line.scriptProfile.dominantScript === candidateScript);
}

function groupCandidateLines(lines: CandidateLine[]): CandidateLine[][] {
  if (lines.length === 0) return [];

  const groups: CandidateLine[][] = [];
  let groupStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const currentGroup = groups[groups.length - 1];

    if (!currentGroup) {
      groups.push([line]);
      groupStartIndex = index;
      continue;
    }

    if (currentGroup.length >= MAX_GROUP_SIZE) {
      groups.push([line]);
      groupStartIndex = index;
      continue;
    }

    const tolerance = getGroupTolerance(lines, groupStartIndex);
    const withinTolerance = Math.abs(line.startMs - currentGroup[0].startMs) <= tolerance;

    if (withinTolerance && !shouldKeepSeparateForScriptSimilarity(currentGroup, line)) {
      currentGroup.push(line);
      continue;
    }

    groups.push([line]);
    groupStartIndex = index;
  }

  return groups;
}

function getTrackRoleHint(track: LyricTrack): TrackRoleHint | undefined {
  const translationCount = track.lines.filter((line) => line.explicitRole === 'translation').length;
  const romanizationCount = track.lines.filter((line) => line.explicitRole === 'roman').length;

  if (translationCount === 0 && romanizationCount === 0) return undefined;
  if (translationCount >= romanizationCount) return 'translation';
  return 'romanization';
}

function getTrackDominantScript(lines: LyricTrackLine[]): DominantScript {
  const counts = lines.reduce((profile, line) => {
    const lineProfile = getLineScriptProfile(line.text);
    return {
      latinCount: profile.latinCount + lineProfile.latinCount,
      hanCount: profile.hanCount + lineProfile.hanCount,
      kanaCount: profile.kanaCount + lineProfile.kanaCount,
      hangulCount: profile.hangulCount + lineProfile.hangulCount,
    };
  }, {
    latinCount: 0,
    hanCount: 0,
    kanaCount: 0,
    hangulCount: 0,
  });

  return resolveDominantScript(counts);
}

function getTrackSourceFormat(lines: CandidateLine[]): ParsedLineSourceFormat | 'mixed' {
  const formats = new Set(lines.map((line) => line.sourceFormat));
  return formats.size === 1 ? lines[0].sourceFormat : 'mixed';
}

function getTrackTimingMode(lines: LyricTrackLine[]): LyricTrack['timingMode'] {
  if (lines.some((line) => (line.words || []).length > 0)) return 'word';
  if (lines.length > 0) return 'line';
  return 'none';
}

function scoreScriptCompatibility(track: LyricTrack, candidate: CandidateLine): number {
  const trackScript = track.dominantScript;
  const candidateScript = candidate.scriptProfile.dominantScript;

  if (trackScript === candidateScript) return 4;
  if (trackScript === 'mixed' || candidateScript === 'mixed' || trackScript === 'other' || candidateScript === 'other') {
    return 1.2;
  }

  if (getScriptFamily(trackScript) === getScriptFamily(candidateScript)) {
    return 0.8;
  }

  return -2.2;
}

function scoreTrackMatch(
  track: LyricTrack,
  candidate: CandidateLine,
  clusterIndex: number,
  slotIndex: number,
): number {
  const lastLine = track.lines[track.lines.length - 1];
  if (!lastLine) return 0;
  if ((lastLine.clusterIndex ?? -1) === clusterIndex) return Number.NEGATIVE_INFINITY;
  if (candidate.startMs <= lastLine.startMs) return Number.NEGATIVE_INFINITY;

  const trackRoleHint = getTrackRoleHint(track);
  const candidateRoleHint = mapExplicitRoleToTrackRole(candidate.explicitRole);
  if (trackRoleHint && candidateRoleHint && trackRoleHint !== candidateRoleHint) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (trackRoleHint && candidateRoleHint === trackRoleHint) score += 6;
  if (!trackRoleHint && candidateRoleHint) score += 1.2;

  score += scoreScriptCompatibility(track, candidate);

  const averageSlot = average(track.lines.map((line) => line.slotIndex ?? 0));
  score += Math.max(-1.8, 2.2 - (Math.abs(averageSlot - slotIndex) * 1.35));

  const averageSourceIndex = average(track.lines.map((line) => line.sourceIndex));
  score += Math.max(-1, 1.4 - (Math.abs(averageSourceIndex - candidate.sourceIndex) * 0.35));

  const clusterGap = clusterIndex - (lastLine.clusterIndex ?? clusterIndex);
  score += clusterGap === 1 ? 1.2 : 0.4;

  const timeGap = candidate.startMs - lastLine.startMs;
  if (timeGap < 120 && track.dominantScript === candidate.scriptProfile.dominantScript && !candidate.explicitRole) {
    score -= 1.4;
  }

  return score;
}

function createTrackFromCandidate(candidate: CandidateLine, clusterIndex: number, slotIndex: number, trackIndex: number): LyricTrack {
  const line = {
    ...candidate,
    clusterIndex,
    slotIndex,
  };

  return {
    id: `track:${trackIndex}`,
    role: 'unknown',
    timingMode: getTrackTimingMode([line]),
    sourceFormat: candidate.sourceFormat,
    confidence: 0,
    dominantScript: candidate.scriptProfile.dominantScript,
    lines: [line],
    attachments: [],
  };
}

function buildTracksFromGroups(groups: CandidateLine[][]): LyricTrack[] {
  const tracks: LyricTrack[] = [];

  groups.forEach((group, clusterIndex) => {
    const usedTrackIds = new Set<string>();

    group.forEach((candidate, slotIndex) => {
      let bestTrack: LyricTrack | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const track of tracks) {
        if (usedTrackIds.has(track.id)) continue;

        const score = scoreTrackMatch(track, candidate, clusterIndex, slotIndex);
        if (score > bestScore) {
          bestScore = score;
          bestTrack = track;
        }
      }

      if (!bestTrack || bestScore < MIN_TRACK_MATCH_SCORE) {
        const track = createTrackFromCandidate(candidate, clusterIndex, slotIndex, tracks.length);
        tracks.push(track);
        usedTrackIds.add(track.id);
        return;
      }

      bestTrack.lines.push({
        ...candidate,
        clusterIndex,
        slotIndex,
      });
      bestTrack.dominantScript = getTrackDominantScript(bestTrack.lines);
      bestTrack.sourceFormat = getTrackSourceFormat(bestTrack.lines as CandidateLine[]);
      bestTrack.timingMode = getTrackTimingMode(bestTrack.lines);
      usedTrackIds.add(bestTrack.id);
    });
  });

  return tracks;
}

function scorePairAlignment(driftMs: number): number {
  const absDrift = Math.abs(driftMs);
  if (absDrift <= ALIGNMENT_HIGH_WINDOW_MS) return 1;
  if (absDrift <= ALIGNMENT_MEDIUM_WINDOW_MS) return 0.72;
  if (absDrift <= ALIGNMENT_LOW_WINDOW_MS) return 0.42;
  return 0;
}

function computeTrackAlignment(mainTrack: LyricTrack, auxTrack: LyricTrack): TrackAlignment {
  const pairs: TrackAlignmentPair[] = [];
  const mainLines = mainTrack.lines;
  const auxLines = auxTrack.lines;

  let mainIndex = 0;
  let auxIndex = 0;

  while (mainIndex < mainLines.length && auxIndex < auxLines.length) {
    const mainLine = mainLines[mainIndex];
    let bestAuxIndex = -1;
    let bestDrift = Number.POSITIVE_INFINITY;

    for (let index = auxIndex; index < auxLines.length; index += 1) {
      const drift = auxLines[index].startMs - mainLine.startMs;
      if (Math.abs(drift) > ALIGNMENT_LOW_WINDOW_MS && auxLines[index].startMs > mainLine.startMs) break;
      if (Math.abs(drift) > ALIGNMENT_LOW_WINDOW_MS) continue;

      if (Math.abs(drift) < Math.abs(bestDrift)) {
        bestDrift = drift;
        bestAuxIndex = index;
      }
    }

    if (bestAuxIndex !== -1) {
      pairs.push({
        mainIndex,
        auxIndex: bestAuxIndex,
        driftMs: bestDrift,
        quality: scorePairAlignment(bestDrift),
      });
      mainIndex += 1;
      auxIndex = bestAuxIndex + 1;
      continue;
    }

    if (auxLines[auxIndex].startMs < mainLine.startMs - ALIGNMENT_LOW_WINDOW_MS) {
      auxIndex += 1;
    } else {
      mainIndex += 1;
    }
  }

  const mainCoverage = pairs.length / Math.max(1, mainLines.length);
  const auxCoverage = pairs.length / Math.max(1, auxLines.length);
  const weightedScore = average(pairs.map((pair) => pair.quality)) * Math.min(mainCoverage, auxCoverage);

  return {
    pairs,
    mainCoverage,
    auxCoverage,
    weightedScore,
  };
}

function getAlignmentKey(mainTrackId: string, auxTrackId: string): string {
  return `${mainTrackId}=>${auxTrackId}`;
}

function tokenizeLatinWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function scoreEnglishness(text: string): number {
  const tokens = tokenizeLatinWords(text);
  if (tokens.length === 0) return 0;

  const hintMatches = tokens.filter((token) => ENGLISH_HINT_WORDS.has(token)).length;
  const contractionBonus = /(?:\bi'm\b|\byou're\b|\bwe're\b|\bit's\b|\bi'll\b|\bdon't\b|\bcan't\b)/i.test(text) ? 0.15 : 0;

  return clamp01((hintMatches / tokens.length) * 0.85 + contractionBonus);
}

function scoreRomanizedLatinText(text: string): number {
  const profile = getLineScriptProfile(text);
  if (profile.dominantScript !== 'latin') return 0;

  const tokens = tokenizeLatinWords(text);
  if (tokens.length === 0) return 0;

  const romanPatternRatio = tokens.filter((token) => ROMANIZATION_PATTERN.test(token)).length / tokens.length;
  const shortTokenRatio = tokens.filter((token) => token.length <= 4).length / tokens.length;
  const vowelRatio = average(tokens.map((token) => {
    const vowels = token.match(/[aeiou]/g)?.length ?? 0;
    return token.length > 0 ? vowels / token.length : 0;
  }));
  const englishness = scoreEnglishness(text);

  const tokenCountPenalty = tokens.length === 1 ? 0.25 : tokens.length === 2 ? 0.1 : 0;

  return clamp01(
    (romanPatternRatio * 0.45)
    + (shortTokenRatio * 0.2)
    + (vowelRatio * 0.22)
    + (tokens.some((token) => token.length === 1) ? 0.08 : 0)
    - tokenCountPenalty
    - (englishness * 0.62),
  );
}

function scoreTrackEnglishness(track: LyricTrack): number {
  return average(track.lines.map((line) => scoreEnglishness(line.text)));
}

function scoreTrackRomanization(track: LyricTrack): number {
  return average(track.lines.map((line) => scoreRomanizedLatinText(line.text)));
}

function scoreTrackRoles(mainTrack: LyricTrack, candidateTrack: LyricTrack, alignment: TrackAlignment): TrackRoleScores {
  const roleHint = getTrackRoleHint(candidateTrack);
  const englishness = scoreTrackEnglishness(candidateTrack);
  const romanization = scoreTrackRomanization(candidateTrack);
  const candidateScript = candidateTrack.dominantScript;
  const mainScript = mainTrack.dominantScript;

  let translation = alignment.weightedScore * 0.6;
  let roman = alignment.weightedScore * 0.6;

  if (candidateScript !== mainScript) translation += 0.16;
  if (candidateScript === 'han' && mainScript !== 'han') translation += 0.18;
  if (candidateScript === 'latin' && englishness > 0.28) translation += 0.18;
  translation += englishness * 0.22;
  translation -= romanization * 0.3;
  if (candidateScript === mainScript) translation -= 0.18;

  if (mainScript !== 'latin' && candidateScript === 'latin') {
    roman += 0.32;
  } else if (mainScript === 'latin') {
    roman -= 0.55;
  } else {
    roman -= 0.15;
  }
  roman += romanization * 0.38;
  roman -= englishness * 0.38;
  if (candidateScript !== 'latin') roman -= 0.28;

  if (roleHint === 'translation') translation += 0.85;
  if (roleHint === 'romanization') roman += 0.85;

  const hasDirectGroupedPair = alignment.pairs.some((pair) => (
    mainTrack.lines[pair.mainIndex]?.clusterIndex !== undefined
    && mainTrack.lines[pair.mainIndex]?.clusterIndex === candidateTrack.lines[pair.auxIndex]?.clusterIndex
  ));
  if (alignment.pairs.length === 1 && !hasDirectGroupedPair && !roleHint) {
    translation *= 0.5;
    roman *= 0.4;
  }

  return {
    main: 0,
    translation: clamp01(translation),
    romanization: clamp01(roman),
  };
}

function getSharedSourceOriginMatchRatio(
  mainTrack: LyricTrack,
  auxTrack: LyricTrack,
  alignment: TrackAlignment,
  roleSource?: ClassificationConfidence,
): number {
  if (alignment.pairs.length === 0) return 0;

  const matchedPairs = alignment.pairs.filter((pair) => {
    const mainLine = mainTrack.lines[pair.mainIndex];
    const auxLine = auxTrack.lines[pair.auxIndex];
    if (!mainLine || !auxLine) return false;
    if (roleSource && auxLine.roleSource !== roleSource) return false;

    return Math.floor(mainLine.sourceIndex) === Math.floor(auxLine.sourceIndex);
  });

  return matchedPairs.length / alignment.pairs.length;
}

function scoreMainTrack(candidateTrack: LyricTrack, tracks: LyricTrack[], getAlignment: (mainTrack: LyricTrack, auxTrack: LyricTrack) => TrackAlignment): number {
  const maxLineCount = Math.max(...tracks.map((track) => track.lines.length), 1);
  const maxSlot = Math.max(...tracks.flatMap((track) => track.lines.map((line) => line.slotIndex ?? 0)), 0);
  const roleHint = getTrackRoleHint(candidateTrack);
  const averageSlot = average(candidateTrack.lines.map((line) => line.slotIndex ?? 0));
  const wordCoverage = candidateTrack.lines.filter((line) => (line.words || []).length > 0).length / Math.max(1, candidateTrack.lines.length);

  let score = 0;
  score += (candidateTrack.lines.length / maxLineCount) * 3;
  score += wordCoverage * 1.4;
  score += maxSlot > 0 ? (1 - (averageSlot / maxSlot)) * 1.2 : 1;

  if (roleHint === 'translation' || roleHint === 'romanization') {
    score -= 4;
  }

  let attachmentSupport = 0;
  const hasRomanizedLatinSibling = tracks.some((track) => {
    if (track.id === candidateTrack.id) return false;
    const alignment = getAlignment(candidateTrack, track);
    return alignment.weightedScore >= 0.35
      && track.dominantScript === 'latin'
      && scoreTrackRomanization(track) >= 0.35;
  });

  for (const track of tracks) {
    if (track.id === candidateTrack.id) continue;
    const alignment = getAlignment(candidateTrack, track);
    if (alignment.weightedScore < 0.28) continue;

    const roleScores = scoreTrackRoles(candidateTrack, track, alignment);
    attachmentSupport += Math.max(roleScores.translation, roleScores.romanization);
  }

  score += Math.min(3, attachmentSupport);
  score += Math.min(2, tracks.reduce((sum, track) => {
    if (track.id === candidateTrack.id) return sum;
    const alignment = getAlignment(candidateTrack, track);
    if (alignment.weightedScore < 0.28) return sum;

    return sum + (getSharedSourceOriginMatchRatio(candidateTrack, track, alignment, 'parser-native') * 3.2);
  }, 0));

  if (candidateTrack.dominantScript !== 'latin' && hasRomanizedLatinSibling) {
    score += 3.2;
  }

  if (
    candidateTrack.dominantScript === 'latin'
    && scoreTrackEnglishness(candidateTrack) < 0.28
    && scoreTrackRomanization(candidateTrack) >= 0.28
    && tracks.some((track) => track.id !== candidateTrack.id && getAlignment(candidateTrack, track).weightedScore >= 0.45 && track.dominantScript !== 'latin')
  ) {
    score -= 4.2;
  }

  return score;
}

function getTrackConfidence(role: LyricTrackRole, scores: TrackRoleScores): number {
  if (role === 'main') return clamp01(scores.main / 6);
  if (role === 'translation') return scores.translation;
  if (role === 'romanization') return scores.romanization;
  if (role === 'secondary') return Math.max(scores.translation, scores.romanization) * 0.7;
  if (role === 'alternate-main') return clamp01(scores.main / 6);
  return 0.25;
}

function resolveSemanticConfidence(lines: Array<LyricTrackLine | undefined>): ClassificationConfidence {
  if (lines.some((line) => line?.roleSource === 'explicit')) return 'explicit';
  if (lines.some((line) => line?.roleSource === 'parser-native')) return 'parser-native';
  return 'heuristic';
}

function shouldAttachAlignedPair(
  mainTrack: LyricTrack,
  auxTrack: LyricTrack,
  alignment: TrackAlignment,
  pair: TrackAlignmentPair,
): boolean {
  const mainLine = mainTrack.lines[pair.mainIndex];
  const auxLine = auxTrack.lines[pair.auxIndex];
  if (!mainLine || !auxLine) return false;

  if (Math.abs(pair.driftMs) <= MAX_GROUP_TOLERANCE_MS) return true;
  if (mainLine.clusterIndex !== undefined && mainLine.clusterIndex === auxLine.clusterIndex) return true;
  if (auxLine.roleSource === 'explicit' || auxLine.roleSource === 'parser-native') return true;

  return alignment.mainCoverage >= 0.75
    && alignment.auxCoverage >= 0.75
    && Math.abs(pair.driftMs) <= ALIGNMENT_HIGH_WINDOW_MS;
}

function buildAlignedRomanWords(mainLine: LyricTrackLine, romanLine?: LyricTrackLine): SemanticLine['romanWords'] {
  const mainWords = mainLine.words ?? [];

  if (mainWords.some((word) => (word.romanText || '').length > 0)) {
    return mainWords.map((word) => ({
      text: word.romanText || '',
      startMs: word.startMs,
      endMs: word.endMs,
    })).filter((word) => word.text.length > 0);
  }

  const romanWords = romanLine?.words ?? [];
  if (mainWords.length === 0 || romanWords.length === 0) return romanWords.length > 0 ? romanWords : undefined;
  if (mainWords.length !== romanWords.length) return undefined;

  const allAligned = mainWords.every((word, index) => {
    const target = romanWords[index];
    return Math.abs(word.startMs - target.startMs) <= 120
      && Math.abs(word.endMs - target.endMs) <= 120;
  });

  return allAligned ? romanWords : undefined;
}

export function buildLyricDocument(lines: ParsedLine[]): LyricDocument {
  const candidateLines = buildCandidateLines(lines);
  const groups = groupCandidateLines(candidateLines);
  const baseTracks = buildTracksFromGroups(groups);

  if (baseTracks.length === 0) {
    return {
      metadata: {
        totalLines: 0,
        sourceFormats: [],
      },
      tracks: [],
      issues: [],
      confidence: 0,
    };
  }

  const alignmentCache = new Map<string, TrackAlignment>();
  const getAlignment = (mainTrack: LyricTrack, auxTrack: LyricTrack) => {
    const key = getAlignmentKey(mainTrack.id, auxTrack.id);
    const cached = alignmentCache.get(key);
    if (cached) return cached;

    const computed = computeTrackAlignment(mainTrack, auxTrack);
    alignmentCache.set(key, computed);
    return computed;
  };

  let displayTrack = baseTracks[0];
  let displayTrackScore = Number.NEGATIVE_INFINITY;

  for (const track of baseTracks) {
    const score = scoreMainTrack(track, baseTracks, getAlignment);
    if (score > displayTrackScore) {
      displayTrackScore = score;
      displayTrack = track;
    }
  }

  const finalizedTracks = baseTracks.map((track) => {
    if (track.id === displayTrack.id) {
      const scores = {
        main: displayTrackScore,
        translation: 0,
        romanization: 0,
      };

      return {
        ...track,
        role: 'main' as const,
        confidence: getTrackConfidence('main', scores),
        scores,
      };
    }

    const alignment = getAlignment(displayTrack, track);
    const scores = scoreTrackRoles(displayTrack, track, alignment);

    let role: LyricTrackRole = 'unknown';
    if (alignment.weightedScore < 0.25) {
      role = track.lines.length >= displayTrack.lines.length * 0.6
        && track.dominantScript === displayTrack.dominantScript
        ? 'alternate-main'
        : 'unknown';
    } else if (scores.translation >= 0.58 || scores.romanization >= 0.58) {
      role = scores.translation >= scores.romanization ? 'translation' : 'romanization';
    } else {
      role = 'secondary';
    }

    return {
      ...track,
      role,
      confidence: getTrackConfidence(role, {
        ...scores,
        main: scoreMainTrack(track, baseTracks, getAlignment),
      }),
      scores: {
        ...scores,
        main: scoreMainTrack(track, baseTracks, getAlignment),
      },
    };
  });

  const displayTrackFinal = finalizedTracks.find((track) => track.id === displayTrack.id) ?? finalizedTracks[0];
  const attachments = finalizedTracks
    .filter((track) => track.id !== displayTrackFinal.id && (track.role === 'translation' || track.role === 'romanization' || track.role === 'secondary'))
    .map((track) => {
      const alignment = getAlignment(displayTrackFinal, track);
      return {
        trackId: track.id,
        role: track.role as Extract<LyricTrackRole, 'translation' | 'romanization' | 'secondary'>,
        confidence: track.confidence,
        lineMatchRatio: alignment.mainCoverage,
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  const tracks = finalizedTracks.map((track) => {
    if (track.id !== displayTrackFinal.id) return track;
    return {
      ...track,
      attachments,
    };
  });

  const issues = tracks.length > 1 && attachments.length === 0
    ? [{
        code: 'lyrics.unattached_tracks',
        message: 'Detected multiple lyric tracks but could not confidently attach any secondary track to the display main track.',
        severity: 'warning' as const,
      }]
    : [];

  return {
    metadata: {
      totalLines: candidateLines.length,
      sourceFormats: [...new Set(candidateLines.map((line) => line.sourceFormat))],
    },
    tracks,
    issues,
    confidence: average(tracks.map((track) => track.confidence)),
    displayTrackId: displayTrackFinal.id,
  };
}

export function lyricDocumentToSemanticLines(document: LyricDocument): SemanticLine[] {
  const mainTrack = document.tracks.find((track) => track.id === document.displayTrackId)
    ?? document.tracks.find((track) => track.role === 'main');
  if (!mainTrack) return [];

  const alignmentCache = new Map<string, TrackAlignment>();
  const getAlignment = (auxTrack: LyricTrack) => {
    const key = getAlignmentKey(mainTrack.id, auxTrack.id);
    const cached = alignmentCache.get(key);
    if (cached) return cached;

    const computed = computeTrackAlignment(mainTrack, auxTrack);
    alignmentCache.set(key, computed);
    return computed;
  };

  const translationTracks = document.tracks
    .filter((track) => track.role === 'translation')
    .sort((left, right) => right.confidence - left.confidence);
  const romanizationTracks = document.tracks
    .filter((track) => track.role === 'romanization')
    .sort((left, right) => right.confidence - left.confidence);
  const secondaryTracks = document.tracks
    .filter((track) => track.role === 'secondary')
    .sort((left, right) => right.confidence - left.confidence);

  const translationLookups = translationTracks.map((track) => ({
    track,
    lookup: new Map(
      getAlignment(track).pairs
        .filter((pair) => shouldAttachAlignedPair(mainTrack, track, getAlignment(track), pair))
        .map((pair) => [pair.mainIndex, pair.auxIndex]),
    ),
  }));
  const romanizationLookups = romanizationTracks.map((track) => ({
    track,
    lookup: new Map(
      getAlignment(track).pairs
        .filter((pair) => shouldAttachAlignedPair(mainTrack, track, getAlignment(track), pair))
        .map((pair) => [pair.mainIndex, pair.auxIndex]),
    ),
  }));
  const secondaryLookups = secondaryTracks.map((track) => ({
    track,
    lookup: new Map(
      getAlignment(track).pairs
        .filter((pair) => shouldAttachAlignedPair(mainTrack, track, getAlignment(track), pair))
        .map((pair) => [pair.mainIndex, pair.auxIndex]),
    ),
  }));
  const attachedLineKeys = new Set<string>();

  const semanticLines = mainTrack.lines.map((mainLine, mainIndex) => {
    const translationEntry = translationLookups.find(({ lookup }) => lookup.has(mainIndex));
    const translationLine = translationEntry
      ? translationEntry.track.lines[translationEntry.lookup.get(mainIndex) ?? -1]
      : undefined;
    const romanizationEntry = romanizationLookups.find(({ lookup }) => lookup.has(mainIndex));
    const romanizationLine = romanizationEntry
      ? romanizationEntry.track.lines[romanizationEntry.lookup.get(mainIndex) ?? -1]
      : undefined;
    const secondaryTexts = secondaryLookups
      .map(({ track, lookup }) => {
        const index = lookup.get(mainIndex);
        return index !== undefined ? track.lines[index]?.text || '' : '';
      })
      .filter((text) => text.length > 0);

    if (translationEntry) {
      attachedLineKeys.add(`${translationEntry.track.id}:${translationEntry.lookup.get(mainIndex)}`);
    }
    if (romanizationEntry) {
      attachedLineKeys.add(`${romanizationEntry.track.id}:${romanizationEntry.lookup.get(mainIndex)}`);
    }
    for (const { track, lookup } of secondaryLookups) {
      const attachedIndex = lookup.get(mainIndex);
      if (attachedIndex !== undefined) {
        attachedLineKeys.add(`${track.id}:${attachedIndex}`);
      }
    }

    const romanWords = buildAlignedRomanWords(mainLine, romanizationLine);

    return {
      startMs: mainLine.startMs,
      endMs: mainLine.endMs,
      mainText: mainLine.text,
      mainWords: mainLine.words,
      translationText: translationLine?.text || undefined,
      romanText: romanizationLine?.text || undefined,
      romanWords,
      secondaryTexts: secondaryTexts.length > 0 ? secondaryTexts : undefined,
      confidence: resolveSemanticConfidence([
        mainLine,
        translationLine,
        romanizationLine,
      ]),
    } satisfies SemanticLine;
  }).filter((line) => line.mainText.length > 0 || line.translationText || line.romanText);

  const orphanLines = document.tracks
    .filter((track) => track.id !== mainTrack.id)
    .flatMap((track) => track.lines.map((line, index) => ({
      line,
      index,
      track,
    })))
    .filter(({ track, index }) => !attachedLineKeys.has(`${track.id}:${index}`))
    .map(({ line }) => ({
      startMs: line.startMs,
      endMs: line.endMs,
      mainText: line.text,
      mainWords: line.words,
      confidence: resolveSemanticConfidence([line]),
    } satisfies SemanticLine));

  return [...semanticLines, ...orphanLines]
    .sort((left, right) => (left.startMs - right.startMs) || ((left.endMs - right.endMs)))
    .filter((line, index, lines) => {
      if (index === 0) return true;
      const previous = lines[index - 1];
      return !(
        previous.startMs === line.startMs
        && previous.endMs === line.endMs
        && previous.mainText === line.mainText
      );
    });
}

export function buildSemanticLines(lines: ParsedLine[]): SemanticLine[] {
  return lyricDocumentToSemanticLines(buildLyricDocument(lines));
}
