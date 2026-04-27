import type { DiffHunk } from './store';

/**
 * Walk DOM nodes inside `container` and add a `diff-added` CSS class to every
 * element whose `data-source-line` value falls within any of the given diff hunks.
 *
 * `data-source-line` is set by rehypeAnnotateLines and holds the 1-based line
 * number in the source markdown where the element starts.
 *
 * For elements that span multiple lines (e.g. a list item or paragraph), we
 * only have the start line — so we highlight any element whose start line
 * falls inside a hunk.  This may over-highlight slightly at hunk boundaries
 * but it's intentional: we want the reader to see *which block* changed.
 */
export function applyDiffHighlights(container: HTMLElement, hunks: DiffHunk[]): void {
  if (!hunks.length) return;

  const elements = container.querySelectorAll<HTMLElement>('[data-source-line]');
  for (const el of elements) {
    const line = parseInt(el.dataset.sourceLine ?? '0', 10);
    if (isInHunks(line, hunks)) {
      el.classList.add('diff-added');
    }
  }
}

export function removeDiffHighlights(container: HTMLElement): void {
  container.querySelectorAll('.diff-added').forEach((el) => {
    el.classList.remove('diff-added');
  });
}

function isInHunks(line: number, hunks: DiffHunk[]): boolean {
  for (const h of hunks) {
    if (line >= h.startLine && line < h.startLine + h.lineCount) return true;
  }
  return false;
}
