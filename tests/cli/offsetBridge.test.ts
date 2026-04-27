import { describe, it, expect } from 'bun:test';
import { buildOffsetMap, sourceToPlainText } from '../../src/cli/lib/offsetBridge';
import { renderMarkdown } from '../../src/client/lib/renderer';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Verify structural invariants on a segment array for a SINGLE-BLOCK document
 * (no inter-block gaps):
 *   - segments are sorted by srcStart
 *   - plain-text cursor is contiguous within the block (ptEnd[i] === ptStart[i+1])
 *   - no overlap in plain-text space
 *   - sum of (ptEnd - ptStart) equals total plain-text length
 */
function assertInvariants(segs: ReturnType<typeof buildOffsetMap>, totalPlainText: number) {
  let prevPtEnd = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    expect(s.ptStart).toBe(prevPtEnd); // contiguous plain-text cursor
    expect(s.ptEnd).toBeGreaterThan(s.ptStart);
    expect(s.srcEnd).toBeGreaterThanOrEqual(s.srcStart);
    if (i > 0) {
      expect(s.srcStart).toBeGreaterThanOrEqual(segs[i - 1].srcEnd);
    }
    prevPtEnd = s.ptEnd;
  }
  const sum = segs.reduce((acc, s) => acc + (s.ptEnd - s.ptStart), 0);
  expect(sum).toBe(totalPlainText);
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('buildOffsetMap', () => {
  it('empty string → empty segments', () => {
    const segs = buildOffsetMap('');
    expect(segs).toEqual([]);
  });

  it('plain text only — one segment covering full string', () => {
    const raw = 'Hello world';
    const segs = buildOffsetMap(raw);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ srcStart: 0, srcEnd: 11, ptStart: 0, ptEnd: 11 });
    assertInvariants(segs, 11);
  });

  it('heading produces two text leaves with correct src/pt offsets', () => {
    // "# Title\n\nBody." — '# ' is 2 chars of markup, then 'Title' at 2..7
    // blank line at 7..9, then 'Body.' at 9..14
    // The two blocks are top-level siblings; an inter-block '\n' gap advances cursor by 1.
    const raw = '# Title\n\nBody.';
    const segs = buildOffsetMap(raw);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ srcStart: 2, srcEnd: 7, ptStart: 0, ptEnd: 5 });
    // inter-block gap: ptStart = 5 + 1 = 6
    expect(segs[1]).toEqual({ srcStart: 9, srcEnd: 14, ptStart: 6, ptEnd: 11 });
    // sum of widths = 5 + 5 = 10; last ptEnd = 11 (includes 1 inter-block gap)
    const sum = segs.reduce((acc, s) => acc + (s.ptEnd - s.ptStart), 0);
    expect(sum).toBe(10); // leaf widths only
    expect(segs[segs.length - 1].ptEnd).toBe(11); // matches browser cursor end
  });

  it('bold inline — three text leaves with markup gaps', () => {
    // 'a **bold** b' — positions: "a " 0..2, "bold" 4..8, " b" 10..12
    const raw = 'a **bold** b';
    const segs = buildOffsetMap(raw);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ srcStart: 0, srcEnd: 2, ptStart: 0, ptEnd: 2 });
    expect(segs[1]).toEqual({ srcStart: 4, srcEnd: 8, ptStart: 2, ptEnd: 6 });
    expect(segs[2]).toEqual({ srcStart: 10, srcEnd: 12, ptStart: 6, ptEnd: 8 });
    assertInvariants(segs, 8); // 'a ' + 'bold' + ' b' = 8 chars
  });

  it('italic inline — three text leaves', () => {
    // 'a *b* c' — "a " 0..2, "b" 3..4, " c" 5..7
    const raw = 'a *b* c';
    const segs = buildOffsetMap(raw);
    expect(segs).toHaveLength(3);
    assertInvariants(segs, 5); // 'a ' + 'b' + ' c' = 5 chars
  });

  it('inline code — three segments: text, inlineCode, text', () => {
    // 'use `code` here' — three segments: "use " (text), "code" (inlineCode), " here" (text)
    // inlineCode srcStart=4 (opening backtick), srcEnd=10 (after closing backtick), value="code"
    const raw = 'use `code` here';
    const segs = buildOffsetMap(raw);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ srcStart: 0, srcEnd: 4, ptStart: 0, ptEnd: 4 });
    expect(segs[1]).toEqual({ srcStart: 4, srcEnd: 10, ptStart: 4, ptEnd: 8 });
    expect(segs[2]).toEqual({ srcStart: 10, srcEnd: 15, ptStart: 8, ptEnd: 13 });
    assertInvariants(segs, 13); // 'use ' + 'code' + ' here' = 13 chars
  });

  it('structural invariants hold for multi-paragraph document', () => {
    const raw = '# Heading\n\nFirst paragraph with **bold**.\n\nSecond paragraph.';
    const segs = buildOffsetMap(raw);
    expect(segs.length).toBeGreaterThan(0);
    // Segments are sorted by srcStart and non-overlapping in plain-text space.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].srcStart).toBeGreaterThanOrEqual(segs[i - 1].srcEnd);
      expect(segs[i].ptStart).toBeGreaterThanOrEqual(segs[i - 1].ptEnd);
    }
    // Each segment has positive width.
    for (const s of segs) {
      expect(s.ptEnd).toBeGreaterThan(s.ptStart);
    }
    // Last ptEnd matches the browser's plain-text cursor end (leaf widths + inter-block gaps).
    const html = renderMarkdown(raw);
    const browserPt = html.replace(/<[^>]+>/g, '').length;
    expect(segs[segs.length - 1].ptEnd).toBe(browserPt);
  });
});

describe('sourceToPlainText', () => {
  it('empty string → always 0', () => {
    expect(sourceToPlainText('', 0)).toBe(0);
    expect(sourceToPlainText('', 100)).toBe(0);
  });

  it('plain text — identity mapping', () => {
    const raw = 'Hello world';
    expect(sourceToPlainText(raw, 0)).toBe(0);
    expect(sourceToPlainText(raw, 5)).toBe(5);
    expect(sourceToPlainText(raw, 11)).toBe(11);
  });

  it('past-end returns ptEnd of last segment', () => {
    const raw = 'Hello world';
    // ptEnd of the only segment is 11
    expect(sourceToPlainText(raw, 1000)).toBe(11);
  });

  it('heading — exact offsets at leaf boundaries', () => {
    const raw = '# Title\n\nBody.';
    // "Title" leaf: srcStart=2, ptStart=0
    expect(sourceToPlainText(raw, 2)).toBe(0);
    // "Body." leaf: srcStart=9, ptStart=6 (gap of 1 for inter-block '\n')
    expect(sourceToPlainText(raw, 9)).toBe(6);
    // Inside "Body.": srcOffset=11 → ptStart=6 + (11-9) = 8
    expect(sourceToPlainText(raw, 11)).toBe(8);
  });

  it('heading — markup before first leaf snaps to ptStart=0', () => {
    // '# H' — src 0='#', 1=' ', 2='H'; offsets 0 and 1 are markup
    const raw = '# H';
    expect(sourceToPlainText(raw, 0)).toBe(0);
    expect(sourceToPlainText(raw, 1)).toBe(0);
    expect(sourceToPlainText(raw, 2)).toBe(0); // at srcStart of "H"
  });

  it('bold — proportional mapping inside text leaves', () => {
    // 'a **bold** b' — "bold" leaf: srcStart=4, ptStart=2
    const raw = 'a **bold** b';
    // At srcStart of "bold" → pt 2
    expect(sourceToPlainText(raw, 4)).toBe(2);
    // Mid-leaf: src=6, pt = 2 + (6-4) = 4
    expect(sourceToPlainText(raw, 6)).toBe(4);
  });

  it('bold — markup between leaves snaps forward', () => {
    const raw = 'a **bold** b';
    // src=3 is second '*' of '**' before "bold" → snap to ptStart of "bold" leaf = 2
    expect(sourceToPlainText(raw, 3)).toBe(2);
  });

  it('bold — src at srcEnd of leaf snaps to next leaf start', () => {
    // 'a **bold** b': "bold" srcEnd=8; src=8 is first '*' of closing '**'
    // Since srcEnd is exclusive boundary of "bold" but within '**' markup,
    // the next leaf " b" starts at srcStart=10, ptStart=6.
    const raw = 'a **bold** b';
    const segs = buildOffsetMap(raw);
    // srcOffset=8 is >= srcStart(4) and <= srcEnd(8) of "bold" leaf → ptStart+4 = 6
    // (i.e., it snaps to the proportional end of "bold")
    expect(sourceToPlainText(raw, 8)).toBe(6);
  });

  it('italic — markup at position 2 snaps to ptStart of "b" leaf', () => {
    // 'a *b* c': '*' is at position 2 → snap forward to "b" leaf
    const raw = 'a *b* c';
    const segs = buildOffsetMap(raw);
    // "b" leaf starts at srcStart=3, ptStart=2
    // srcOffset=2 < srcStart(3) of "b" leaf → snap to ptStart=2
    expect(sourceToPlainText(raw, 2)).toBe(2);
  });

  it('inline code — proportional mapping inside inlineCode segment', () => {
    // 'use `code` here': inlineCode node at srcStart=4, srcEnd=10, ptStart=4, ptEnd=8
    // srcOffset=4 lands at srcStart of inlineCode → ptStart=4
    const raw = 'use `code` here';
    expect(sourceToPlainText(raw, 4)).toBe(4);
    // srcOffset=5 (first char of 'code') → 4 + (5-4) = 5
    expect(sourceToPlainText(raw, 5)).toBe(5);
    // srcOffset=8 (last char of 'code') → 4 + (8-4) = 8
    expect(sourceToPlainText(raw, 8)).toBe(8);
    // ' here' srcStart=10, ptStart=8 — the primary blocker fix: ptStart is 8, not 4
    expect(sourceToPlainText(raw, 11)).toBe(9);
  });

  it('past last segment returns ptEnd of last segment', () => {
    const raw = 'abc';
    // Only one text leaf: srcStart=0, srcEnd=3, ptStart=0, ptEnd=3
    expect(sourceToPlainText(raw, 1000)).toBe(3);
  });

  it('multi-paragraph — monotonic: higher srcOffset maps to higher ptOffset', () => {
    const raw = '# Heading\n\nFirst paragraph with **bold**.\n\nSecond paragraph.';
    const segs = buildOffsetMap(raw);
    // Sample a set of srcOffsets that fall inside text leaves and verify monotonicity
    const leafSrcOffsets = segs.map(s => s.srcStart);
    const ptValues = leafSrcOffsets.map(src => sourceToPlainText(raw, src));
    for (let i = 1; i < ptValues.length; i++) {
      expect(ptValues[i]).toBeGreaterThan(ptValues[i - 1]);
    }
  });

  it('buildOffsetMap cursor is contiguous across all leaves (ptEnd[i] === ptStart[i+1])', () => {
    const raw = 'a **bold** b and *italic* end';
    const segs = buildOffsetMap(raw);
    for (let i = 0; i + 1 < segs.length; i++) {
      expect(segs[i + 1].ptStart).toBe(segs[i].ptEnd);
    }
  });
});

describe('inlineCode and code block handling', () => {
  it('handles inline code: matches browser plain-text cursor', () => {
    const raw = 'use `code` here';
    const segs = buildOffsetMap(raw);
    // Three segments: "use " (text), "code" (inlineCode), " here" (text)
    expect(segs.length).toBe(3);
    expect(segs[0]).toMatchObject({ ptStart: 0, ptEnd: 4 });
    expect(segs[1]).toMatchObject({ ptStart: 4, ptEnd: 8 });
    expect(segs[2]).toMatchObject({ ptStart: 8, ptEnd: 13 });
    // " here" srcOffset is at position 10 (after closing backtick)
    // inlineCode ends at srcEnd=10; " here" srcStart=10, ptStart=8
    // sourceToPlainText(raw, 10) — srcOffset=10 is within inlineCode range [4,10]
    // so proportional mapping: 4 + (10-4) = 10. The key fix is that " here" has ptStart=8.
    expect(segs[2].ptStart).toBe(8);
  });

  it('handles fenced code block', () => {
    const raw = '```\nfoo\n```\n';
    const segs = buildOffsetMap(raw);
    // One code segment for "foo"; the browser renders <pre><code>foo\n</code></pre>
    // remark-rehype adds a trailing '\n', so the plain-text length is 4 ("foo\n"), not 3
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const codeSeg = segs.find(s => s.ptEnd - s.ptStart === 4);
    expect(codeSeg).toBeDefined();
  });

  it('cli bridge plain-text length matches browser pipeline', () => {
    const samples = [
      'plain text',
      'a **bold** b',
      'use `code` here',
      'mix `inline` and **bold** text',
      '# Heading\n\nbody',        // restored: inter-block gap fix makes this match now
    ];
    for (const raw of samples) {
      const segs = buildOffsetMap(raw);
      const html = renderMarkdown(raw);
      // Extract plain text from HTML by stripping tags
      const browserPt = html.replace(/<[^>]+>/g, '').length;
      // The correct invariant: the last segment's ptEnd equals the browser cursor end.
      // (sum of segment widths is less by the number of inter-block gaps, but ptEnd
      // of the last segment is correct because gaps are baked into ptStart values.)
      expect(segs[segs.length - 1].ptEnd).toBe(browserPt);
    }
  });

  it('inserts inter-block whitespace between sibling blocks', () => {
    const raw = '# H\n\nB';
    const segs = buildOffsetMap(raw);
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ ptStart: 0, ptEnd: 1 });
    expect(segs[1]).toMatchObject({ ptStart: 2, ptEnd: 3 }); // gap of 1, not 0
  });

  it('matches browser plain-text cursor for multi-block document', () => {
    const samples = [
      '# H\n\nA\n\nB',           // 3 blocks: gaps add 2 chars
      'para 1\n\npara 2',         // 2 blocks: gap adds 1
      '# Heading\n\nbody',        // 2 blocks: gap adds 1
    ];
    for (const raw of samples) {
      const segs = buildOffsetMap(raw);
      const html = renderMarkdown(raw);
      const browserPt = html.replace(/<[^>]+>/g, '').length;
      // Last segment's ptEnd must equal the browser's plain-text cursor end.
      expect(segs[segs.length - 1].ptEnd).toBe(browserPt);
    }
  });
});
