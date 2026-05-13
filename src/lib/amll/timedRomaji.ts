export const TIMED_ROMAJI_SUBLINE_OPACITY = '1';
export const TIMED_ROMAJI_BASE_OPACITY = '0.3';
export const TIMED_ROMAJI_HIGHLIGHT_OPACITY = '1';

export function shouldRebuildTimedRomajiDom(
  currentSignature: string | undefined,
  nextSignature: string,
  currentWordCount: number,
  nextWordCount: number,
) {
  return currentSignature !== nextSignature || currentWordCount !== nextWordCount;
}

export function getTimedRomajiProgress(currentTime: number, startTime: number, endTime: number) {
  const duration = endTime - startTime;
  if (!Number.isFinite(duration) || duration <= 0) {
    return currentTime >= startTime ? 1 : 0;
  }

  return Math.max(0, Math.min(1, (currentTime - startTime) / duration));
}

export function getTimedRomajiFillProgress(
  currentTime: number,
  lineEndTime: number,
  wordStartTime: number,
  wordEndTime: number,
) {
  if (Number.isFinite(lineEndTime) && currentTime >= lineEndTime) {
    return 0;
  }

  return getTimedRomajiProgress(currentTime, wordStartTime, wordEndTime);
}
