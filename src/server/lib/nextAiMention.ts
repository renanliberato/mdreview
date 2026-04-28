import type { Thread } from '../../shared/types';

const AI_MENTION_RE = /^@ai\b/;

export function selectNextAiMention(threads: Thread[]): Thread | null {
  const candidates: Array<{ thread: Thread; idx: number; lastAt: string }> = [];

  for (let idx = 0; idx < threads.length; idx++) {
    const thread = threads[idx];
    if (thread.resolved) continue;
    if (thread.comments.length === 0) continue;
    const last = thread.comments[thread.comments.length - 1];
    if (!AI_MENTION_RE.test(last.text)) continue;
    candidates.push({ thread, idx, lastAt: last.createdAt });
  }

  if (candidates.length === 0) return null;

  // Oldest last-comment createdAt first; file-array-index as tiebreak (stable sort preserves it)
  candidates.sort((a, b) => {
    const cmp = a.lastAt.localeCompare(b.lastAt);
    return cmp !== 0 ? cmp : a.idx - b.idx;
  });

  return candidates[0].thread;
}
