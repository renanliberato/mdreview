import type { Thread, FilePayload } from './types';

const BLOCK_REGEX = /\n\n<!-- mdreview-comments:[\s\S]*?-->\s*$/;

/**
 * Extract JSON from `<!-- mdreview-comments: {...} -->` at EOF.
 * Returns [] if absent or malformed.
 */
export function parseCommentBlock(raw: string): Thread[] {
  const match = raw.match(/<!-- mdreview-comments:\s*(\{[\s\S]*?\})\s*-->/);
  if (!match) return [];

  try {
    const payload = JSON.parse(match[1]) as FilePayload;
    if (!Array.isArray(payload.threads)) return [];
    return payload.threads;
  } catch {
    return [];
  }
}

/**
 * Remove the mdreview comment block from the raw string.
 */
export function stripCommentBlock(raw: string): string {
  return raw.replace(BLOCK_REGEX, '');
}

/**
 * Serialize threads into an EOF comment block string.
 * Output: `\n\n<!-- mdreview-comments: {JSON} -->\n`
 */
export function serializeCommentBlock(threads: Thread[]): string {
  const payload: FilePayload = { version: '1', threads };
  return `\n\n<!-- mdreview-comments: ${JSON.stringify(payload)} -->\n`;
}
