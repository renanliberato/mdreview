import { describe, it, expect } from 'bun:test';
import { selectNextAiMention } from '../../src/server/lib/nextAiMention';
import type { Thread, Comment } from '../../src/shared/types';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    threadId: 't-1',
    author: 'alice',
    authorType: 'human',
    createdAt: '2025-01-01T00:00:00.000Z',
    text: 'hello',
    anchor: { quote: 'q', startOffset: 0, endOffset: 1, xpath: '/p' },
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> & { comments?: Comment[] } = {}): Thread {
  return {
    id: 't-1',
    resolved: false,
    comments: [makeComment()],
    ...overrides,
  };
}

describe('selectNextAiMention', () => {
  it('returns null for empty input', () => {
    expect(selectNextAiMention([])).toBeNull();
  });

  it('returns null when no thread has @ai as last comment', () => {
    const t = makeThread({ comments: [makeComment({ text: 'just a comment' })] });
    expect(selectNextAiMention([t])).toBeNull();
  });

  it('excludes resolved threads', () => {
    const t = makeThread({
      resolved: true,
      comments: [makeComment({ text: '@ai please help' })],
    });
    expect(selectNextAiMention([t])).toBeNull();
  });

  it('excludes @aiden (word boundary required)', () => {
    const t = makeThread({ comments: [makeComment({ text: '@aiden do this' })] });
    expect(selectNextAiMention([t])).toBeNull();
  });

  it('excludes @AI (case-sensitive)', () => {
    const t = makeThread({ comments: [makeComment({ text: '@AI do this' })] });
    expect(selectNextAiMention([t])).toBeNull();
  });

  it('excludes leading space before @ai', () => {
    const t = makeThread({ comments: [makeComment({ text: ' @ai do this' })] });
    expect(selectNextAiMention([t])).toBeNull();
  });

  it('matches plain @ai', () => {
    const t = makeThread({ id: 't-x', comments: [makeComment({ text: '@ai' })] });
    expect(selectNextAiMention([t])).toBe(t);
  });

  it('matches @ai please', () => {
    const t = makeThread({ id: 't-x', comments: [makeComment({ text: '@ai please explain' })] });
    expect(selectNextAiMention([t])).toBe(t);
  });

  it('matches @ai, (word boundary at punctuation)', () => {
    const t = makeThread({ id: 't-x', comments: [makeComment({ text: '@ai, do this' })] });
    expect(selectNextAiMention([t])).toBe(t);
  });

  it('picks oldest last-comment createdAt among multiple matches', () => {
    const older = makeThread({
      id: 't-older',
      comments: [makeComment({ createdAt: '2025-01-01T00:00:00.000Z', text: '@ai help' })],
    });
    const newer = makeThread({
      id: 't-newer',
      comments: [makeComment({ createdAt: '2025-06-01T00:00:00.000Z', text: '@ai help' })],
    });
    expect(selectNextAiMention([newer, older])?.id).toBe('t-older');
  });

  it('uses file-array-index as tiebreak when timestamps are equal', () => {
    const ts = '2025-01-01T00:00:00.000Z';
    const first = makeThread({
      id: 't-first',
      comments: [makeComment({ createdAt: ts, text: '@ai help' })],
    });
    const second = makeThread({
      id: 't-second',
      comments: [makeComment({ createdAt: ts, text: '@ai help' })],
    });
    expect(selectNextAiMention([first, second])?.id).toBe('t-first');
    expect(selectNextAiMention([second, first])?.id).toBe('t-second');
  });

  it('excludes threads where an earlier (non-tail) comment is @ai but last is not', () => {
    const t = makeThread({
      id: 't-x',
      comments: [
        makeComment({ id: 'c-1', text: '@ai please help' }),
        makeComment({ id: 'c-2', createdAt: '2025-02-01T00:00:00.000Z', text: 'I responded' }),
      ],
    });
    expect(selectNextAiMention([t])).toBeNull();
  });
});
