import { describe, it, expect } from 'bun:test';
import {
  parseCommentBlock,
  stripCommentBlock,
  serializeCommentBlock,
} from '../../src/shared/commentBlock';
import type { Thread } from '../../src/shared/types';

const sampleThread: Thread = {
  id: 't-001',
  resolved: false,
  comments: [
    {
      id: 'c-001',
      threadId: 't-001',
      author: 'renan',
      authorType: 'human',
      createdAt: '2026-04-27T10:00:00Z',
      text: 'Looks good?',
      anchor: {
        quote: 'Redis',
        startOffset: 10,
        endOffset: 15,
        xpath: '/html/body/p[1]',
      },
    },
  ],
};

const rawWithBlock = `# Title\n\nSome content here.\n\n<!-- mdreview-comments: {"version":"1","threads":[{"id":"t-001","resolved":false,"comments":[{"id":"c-001","threadId":"t-001","author":"renan","authorType":"human","createdAt":"2026-04-27T10:00:00Z","text":"Looks good?","anchor":{"quote":"Redis","startOffset":10,"endOffset":15,"xpath":"/html/body/p[1]"}}]}]} -->\n`;

describe('parseCommentBlock', () => {
  it('parses a well-formed block and returns the threads array', () => {
    const threads = parseCommentBlock(rawWithBlock);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('t-001');
    expect(threads[0].comments[0].author).toBe('renan');
  });

  it('returns empty array when there is no comment block', () => {
    const threads = parseCommentBlock('# Title\n\nJust markdown, no block.');
    expect(threads).toEqual([]);
  });

  it('returns empty array when JSON is malformed — no throw', () => {
    const malformed = '# Title\n\n<!-- mdreview-comments: {broken json -->\n';
    expect(() => parseCommentBlock(malformed)).not.toThrow();
    expect(parseCommentBlock(malformed)).toEqual([]);
  });

  it('returns empty array when payload has no threads field', () => {
    const noThreads = '# Title\n\n<!-- mdreview-comments: {"version":"1"} -->\n';
    expect(parseCommentBlock(noThreads)).toEqual([]);
  });
});

describe('serializeCommentBlock', () => {
  it('produces a string containing the JSON payload', () => {
    const block = serializeCommentBlock([sampleThread]);
    expect(block).toContain('<!-- mdreview-comments:');
    expect(block).toContain('"version":"1"');
    expect(block).toContain('"t-001"');
    expect(block).toContain('-->');
  });

  it('starts with a double newline and ends with a newline', () => {
    const block = serializeCommentBlock([]);
    expect(block.startsWith('\n\n')).toBe(true);
    expect(block.endsWith('\n')).toBe(true);
  });
});

describe('stripCommentBlock', () => {
  it('removes the comment block from the raw string', () => {
    const stripped = stripCommentBlock(rawWithBlock);
    expect(stripped).not.toContain('<!-- mdreview-comments:');
    expect(stripped).not.toContain('-->');
  });

  it('leaves content before the block intact', () => {
    const stripped = stripCommentBlock(rawWithBlock);
    expect(stripped).toContain('# Title');
    expect(stripped).toContain('Some content here.');
  });

  it('leaves no trailing whitespace artifacts (no extra blank lines at EOF)', () => {
    const stripped = stripCommentBlock(rawWithBlock);
    // Should not end with more than one trailing newline from original content
    expect(stripped.endsWith('\n\n\n')).toBe(false);
  });

  it('is a no-op when no block is present', () => {
    const plain = '# Title\n\nJust markdown.';
    expect(stripCommentBlock(plain)).toBe(plain);
  });
});

describe('round-trip: serialize → parse', () => {
  it('returns the same threads array after serialize + parse', () => {
    const threads: Thread[] = [sampleThread];
    const block = serializeCommentBlock(threads);
    const prefix = '# Some document\n';
    const reconstructed = prefix + block;
    const parsed = parseCommentBlock(reconstructed);
    expect(parsed).toEqual(threads);
  });

  it('handles empty threads array', () => {
    const block = serializeCommentBlock([]);
    const parsed = parseCommentBlock('# Doc\n' + block);
    expect(parsed).toEqual([]);
  });
});
