import type { SelectionAnchor } from '../../shared/types';

export interface MatchResult {
  strategy: 'exact' | 'fuzzy' | 'line-search';
  offset: number;
}

/**
 * Strategy 1: offset-anchored exact match (within ±50 of stored offset).
 * Searches starting from max(0, anchor.startOffset - 20) and accepts if
 * the hit is within 50 characters of anchor.startOffset.
 */
export function exactNear(raw: string, anchor: SelectionAnchor): MatchResult | null {
  const searchFrom = Math.max(0, anchor.startOffset - 20);
  const near = raw.indexOf(anchor.quote, searchFrom);
  if (near !== -1 && Math.abs(near - anchor.startOffset) < 50) {
    return { strategy: 'exact', offset: near };
  }
  return null;
}

/**
 * Strategy 2: first occurrence of the quote anywhere.
 */
export function firstHit(raw: string, anchor: SelectionAnchor): MatchResult | null {
  const idx = raw.indexOf(anchor.quote);
  return idx !== -1 ? { strategy: 'fuzzy', offset: idx } : null;
}

/**
 * Strategy 3: first 4 whitespace-separated tokens of the quote.
 * Returns null when the quote has fewer than 2 tokens.
 */
export function tokenPrefix(raw: string, anchor: SelectionAnchor): MatchResult | null {
  const tokens = anchor.quote.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const needle = tokens.slice(0, 4).join(' ');
  const idx = raw.indexOf(needle);
  return idx !== -1 ? { strategy: 'line-search', offset: idx } : null;
}

/**
 * Map a 0-based char offset to a 1-based line/col.
 */
export function lineOf(raw: string, offset: number): { line: number; col: number } {
  const before = raw.slice(0, offset);
  const lines = before.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

/**
 * Print a context block: N lines before/after `hitLine` (1-based), with the
 * hit line prefixed by `> `. Line numbers are right-aligned to the max width.
 *
 * Output format:
 *    1  # Heading
 *    2
 *    3  Paragraph text here
 * >  4  matched line
 *    5
 */
export function formatContext(lines: string[], hitLine: number, n: number): string {
  const firstLine = Math.max(1, hitLine - n);
  const lastLine = Math.min(lines.length, hitLine + n);
  const maxNum = lastLine.toString().length;

  const result: string[] = [];
  for (let i = firstLine; i <= lastLine; i++) {
    const num = i.toString().padStart(maxNum, ' ');
    const content = lines[i - 1] ?? '';
    if (i === hitLine) {
      result.push(`>  ${num}  ${content}`);
    } else {
      result.push(`   ${num}  ${content}`);
    }
  }
  return result.join('\n');
}
