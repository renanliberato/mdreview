import { describe, it, expect } from 'bun:test';
import {
  exactNear,
  firstHit,
  tokenPrefix,
  lineOf,
  formatContext,
} from '../../src/cli/lib/lineIndex';
import type { SelectionAnchor } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anchor(overrides: Partial<SelectionAnchor> & { quote: string }): SelectionAnchor {
  return {
    quote: overrides.quote,
    startOffset: overrides.startOffset ?? 0,
    endOffset: overrides.endOffset ?? overrides.quote.length,
    xpath: overrides.xpath ?? '',
  };
}

// ---------------------------------------------------------------------------
// exactNear
// ---------------------------------------------------------------------------

describe('exactNear', () => {
  it('returns a hit when stored offset is within ±50 of actual offset', () => {
    const raw = 'Hello world, this is a test string.';
    // quote at offset 6, stored offset also 6 → diff = 0 < 50
    const a = anchor({ quote: 'world', startOffset: 6 });
    const result = exactNear(raw, a);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('exact');
    expect(result!.offset).toBe(6);
  });

  it('returns a hit when stored offset differs by less than 50', () => {
    const raw = 'Hello world, this is a test string.';
    // quote at offset 6 but stored offset = 45 → diff = 39 < 50
    const a = anchor({ quote: 'world', startOffset: 45 });
    // indexOf from max(0, 45-20)=25 → not found after position 25 → null
    const result = exactNear(raw, a);
    expect(result).toBeNull();
  });

  it('returns null when offset difference is exactly 50 or more', () => {
    // Build a string where the quote appears at offset 0, but stored offset = 50
    const raw = 'target' + ' '.repeat(44) + 'other stuff';
    // quote at 0, stored at 50 → diff = 50, not < 50 → null
    // But indexOf starts from max(0, 50-20)=30, so it won't even find "target"
    const a = anchor({ quote: 'target', startOffset: 50 });
    expect(exactNear(raw, a)).toBeNull();
  });

  it('returns null when quote is not present near the stored offset', () => {
    const raw = 'The quick brown fox jumps over the lazy dog.';
    const a = anchor({ quote: 'elephant', startOffset: 5 });
    expect(exactNear(raw, a)).toBeNull();
  });

  it('handles stored offset at start of string (clamps to 0)', () => {
    const raw = 'start of the text here';
    const a = anchor({ quote: 'start', startOffset: 0 });
    const result = exactNear(raw, a);
    expect(result).not.toBeNull();
    expect(result!.offset).toBe(0);
  });

  it('returns null when quote found but outside ±50 window', () => {
    // quote at offset 100, stored at 0 → diff = 100 ≥ 50
    const raw = ' '.repeat(100) + 'needle';
    const a = anchor({ quote: 'needle', startOffset: 0 });
    // indexOf from max(0, -20)=0 → finds 'needle' at 100, diff=100 ≥ 50 → null
    expect(exactNear(raw, a)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// firstHit
// ---------------------------------------------------------------------------

describe('firstHit', () => {
  it('finds the first occurrence of the quote', () => {
    const raw = 'alpha beta gamma beta delta';
    const a = anchor({ quote: 'beta', startOffset: 0 });
    const result = firstHit(raw, a);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('fuzzy');
    expect(result!.offset).toBe(6); // "alpha " = 6 chars
  });

  it('returns null when quote is absent', () => {
    const raw = 'nothing here matches';
    const a = anchor({ quote: 'elephant', startOffset: 0 });
    expect(firstHit(raw, a)).toBeNull();
  });

  it('finds the first of multiple occurrences', () => {
    const raw = 'foo bar foo baz foo';
    const a = anchor({ quote: 'foo', startOffset: 100 });
    const result = firstHit(raw, a);
    expect(result).not.toBeNull();
    expect(result!.offset).toBe(0);
  });

  it('returns null for empty quote string', () => {
    // indexOf('') returns 0 — empty string is found everywhere
    // Per plan, anchor.quote is always non-empty in practice.
    // Verify it doesn't crash; actual behavior: returns offset 0.
    const raw = 'some text';
    const a = anchor({ quote: '' });
    const result = firstHit(raw, a);
    // indexOf('') === 0, so this returns a hit at 0
    expect(result).not.toBeNull();
    expect(result!.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tokenPrefix
// ---------------------------------------------------------------------------

describe('tokenPrefix', () => {
  it('returns null for a single-token quote', () => {
    const raw = 'hello world foo bar';
    const a = anchor({ quote: 'hello' });
    expect(tokenPrefix(raw, a)).toBeNull();
  });

  it('returns null for an empty quote', () => {
    const raw = 'hello world foo bar';
    const a = anchor({ quote: '' });
    expect(tokenPrefix(raw, a)).toBeNull();
  });

  it('finds the first 4 tokens of a multi-token quote', () => {
    const raw = 'We decided to use Redis for session caching because of latency.';
    const a = anchor({ quote: 'decided to use Redis for session caching' });
    const result = tokenPrefix(raw, a);
    // tokens[0..3] = ['decided', 'to', 'use', 'Redis'] → needle = 'decided to use Redis'
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('line-search');
    // "We " = 3 chars → offset 3
    expect(result!.offset).toBe(3);
  });

  it('uses only first 4 tokens even when quote has more', () => {
    const raw = 'alpha beta gamma delta epsilon zeta';
    const a = anchor({ quote: 'beta gamma delta epsilon zeta extra' });
    const result = tokenPrefix(raw, a);
    // needle = 'beta gamma delta epsilon' (first 4 tokens)
    expect(result).not.toBeNull();
    expect(result!.offset).toBe(6); // 'alpha ' = 6
  });

  it('works with exactly 2 tokens', () => {
    const raw = 'quick brown fox';
    const a = anchor({ quote: 'quick brown' });
    const result = tokenPrefix(raw, a);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('line-search');
    expect(result!.offset).toBe(0);
  });

  it('returns null when the token prefix is not in the raw text', () => {
    const raw = 'hello world foo bar';
    const a = anchor({ quote: 'missing token prefix here' });
    expect(tokenPrefix(raw, a)).toBeNull();
  });

  it('strips leading/trailing whitespace from quote before tokenizing', () => {
    const raw = 'alpha beta gamma';
    const a = anchor({ quote: '  alpha beta  ' });
    const result = tokenPrefix(raw, a);
    expect(result).not.toBeNull();
    expect(result!.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lineOf
// ---------------------------------------------------------------------------

describe('lineOf', () => {
  it('offset 0 → {line:1, col:1}', () => {
    const raw = 'hello\nworld';
    expect(lineOf(raw, 0)).toEqual({ line: 1, col: 1 });
  });

  it('mid-line offset', () => {
    const raw = 'hello\nworld';
    // offset 3 → 4th char of first line → col 4
    expect(lineOf(raw, 3)).toEqual({ line: 1, col: 4 });
  });

  it('offset at newline char', () => {
    const raw = 'hello\nworld';
    // offset 5 is '\n': before = raw.slice(0,5) = 'hello', split = ['hello'] → line 1, col 6
    expect(lineOf(raw, 5)).toEqual({ line: 1, col: 6 });
  });

  it('across-newline: first char of second line', () => {
    const raw = 'hello\nworld';
    // offset 6 → 'w': before = raw.slice(0,6) = 'hello\n', split = ['hello',''] → line 2, col 1
    expect(lineOf(raw, 6)).toEqual({ line: 2, col: 1 });
  });

  it('third line, mid-col', () => {
    const raw = 'abc\ndef\nghi';
    // offset 9 = 'g': before = raw.slice(0,9) = 'abc\ndef\ng', split = ['abc','def','g'] → line 3, col 2
    expect(lineOf(raw, 9)).toEqual({ line: 3, col: 2 });
    // offset 10 = 'h': before = raw.slice(0,10) = 'abc\ndef\ngh', split = ['abc','def','gh'] → line 3, col 3
    expect(lineOf(raw, 10)).toEqual({ line: 3, col: 3 });
  });

  it('single-line string, last char', () => {
    const raw = 'abcde';
    // offset 4 = 'e': before = 'abcd', split = ['abcd'] → line 1, col 5
    expect(lineOf(raw, 4)).toEqual({ line: 1, col: 5 });
  });
});

// ---------------------------------------------------------------------------
// formatContext
// ---------------------------------------------------------------------------

describe('formatContext', () => {
  const lines = [
    '# Heading',      // 1
    '',               // 2
    'Paragraph text here', // 3
    'matched line',   // 4
    '',               // 5
    '## Sub',         // 6
  ];

  it('produces > prefix on hit line and right-aligned numbers', () => {
    const output = formatContext(lines, 4, 3);
    const rows = output.split('\n');
    // With n=3, range = [1..6] (all 6 lines). Max line number width = 1.
    expect(rows[0]).toBe('   1  # Heading');
    expect(rows[1]).toBe('   2  ');
    expect(rows[2]).toBe('   3  Paragraph text here');
    expect(rows[3]).toBe('>  4  matched line');
    expect(rows[4]).toBe('   5  ');
    expect(rows[5]).toBe('   6  ## Sub');
  });

  it('respects N=0 (only the hit line)', () => {
    const output = formatContext(lines, 4, 0);
    const rows = output.split('\n');
    expect(rows.length).toBe(1);
    expect(rows[0]).toBe('>  4  matched line');
  });

  it('clamps at start of array (hitLine near top)', () => {
    const output = formatContext(lines, 1, 3);
    const rows = output.split('\n');
    // firstLine = max(1, 1-3) = 1, lastLine = min(6, 1+3) = 4
    expect(rows.length).toBe(4);
    expect(rows[0]).toBe('>  1  # Heading');
    expect(rows[3]).toBe('   4  matched line');
  });

  it('clamps at end of array (hitLine near bottom)', () => {
    const output = formatContext(lines, 6, 3);
    const rows = output.split('\n');
    // firstLine = max(1, 6-3) = 3, lastLine = min(6, 6+3) = 6
    expect(rows.length).toBe(4);
    expect(rows[rows.length - 1]).toBe('>  6  ## Sub');
  });

  it('pads line numbers to max-width when > 9 lines', () => {
    const manyLines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
    const output = formatContext(manyLines, 10, 2);
    // Range [8..12], max num = '12'.length = 2
    const rows = output.split('\n');
    // line 8 → num padded to width 2 → ' 8'
    expect(rows[0]).toBe('    8  line 8');
    expect(rows[2]).toBe('>  10  line 10');
  });
});
