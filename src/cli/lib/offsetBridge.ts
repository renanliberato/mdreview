import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export interface OffsetSegment {
  /** Inclusive raw-source char offset where this text leaf starts. */
  srcStart: number;
  /** Exclusive raw-source char offset where this text leaf ends. */
  srcEnd: number;
  /** Plain-text cursor position when this leaf begins. */
  ptStart: number;
  /** Plain-text cursor position when this leaf ends. */
  ptEnd: number;
}

/**
 * Walk the mdast (post remark-parse + remark-gfm), producing a sorted array
 * of (srcStart, srcEnd, ptStart, ptEnd) segments — one per text-bearing leaf.
 * Order is document order; segments do not overlap.
 *
 * Handles the following mdast leaf node types, matching the hast `text` nodes
 * that rehypeAnnotateOffsets walks in the browser:
 *   - `text`       — plain text; rendered length equals node.value.length
 *   - `inlineCode` — rendered as <code>VALUE</code>; length equals node.value.length
 *   - `code`       — rendered as <pre><code>VALUE\n</code></pre>; remark-rehype
 *                    appends a trailing '\n', so rendered length is node.value.length + 1
 *
 * Between every two consecutive top-level block siblings, the cursor is advanced
 * by 1 to account for the inter-block '\n' text node that rehype-stringify inserts
 * between sibling block elements in the browser's hast tree.
 */
export function buildOffsetMap(rawStripped: string): OffsetSegment[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(rawStripped) as any;
  const segments: OffsetSegment[] = [];
  const cursor = { value: 0 }; // ref-style so recursive helper can mutate

  function walk(node: any): void {
    // Leaf types that contribute to plain text:
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      const srcStart = node.position?.start?.offset;
      const srcEnd = node.position?.end?.offset;
      if (typeof srcStart !== 'number' || typeof srcEnd !== 'number') return;
      if (typeof node.value !== 'string') return;
      // For block 'code', remark-rehype appends a trailing '\n' to the rendered text.
      // For 'inlineCode' and 'text', the rendered length matches value.length exactly.
      const renderedLen = node.type === 'code' ? node.value.length + 1 : node.value.length;
      segments.push({
        srcStart,
        srcEnd,
        ptStart: cursor.value,
        ptEnd: cursor.value + renderedLen,
      });
      cursor.value += renderedLen;
      return;
    }
    // Recurse into children, if any.
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  }

  // Walk top-level children, inserting an inter-block '\n' (cursor advance of 1)
  // between siblings to mirror the '\n' text node rehype-stringify inserts in the browser.
  if (Array.isArray(tree.children)) {
    for (let i = 0; i < tree.children.length; i++) {
      if (i > 0) cursor.value += 1; // inter-block '\n' from rehype-stringify
      walk(tree.children[i]);
    }
  }

  return segments;
}

/**
 * Convert a raw-source character offset into the corresponding plain-text
 * offset. If the source offset lands inside a text leaf, returns the
 * proportional plain-text position. If it lands in markup between two leaves,
 * snaps forward to the next leaf's start. If past the last leaf, returns the
 * end of the last leaf.
 *
 * Returns 0 when there are no text leaves at all.
 */
export function sourceToPlainText(rawStripped: string, srcOffset: number): number {
  const segs = buildOffsetMap(rawStripped);
  if (segs.length === 0) return 0;
  for (const s of segs) {
    if (srcOffset >= s.srcStart && srcOffset <= s.srcEnd) {
      return s.ptStart + (srcOffset - s.srcStart);
    }
    if (srcOffset < s.srcStart) {
      return s.ptStart; // landed in markup between leaves; snap forward
    }
  }
  // Past the last segment.
  return segs[segs.length - 1].ptEnd;
}
